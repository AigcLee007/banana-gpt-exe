"""Linux-only, stdlib regression tests for the actual remote atomic publisher."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-desktop-release.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class AtomicPublication(unittest.TestCase):
    version = '0.4.6-banana.20'
    token = '0123456789abcdef01234567'

    def fixture(self, mode='manual-mac', failure=None):
        temporary = tempfile.TemporaryDirectory(prefix='desktop-publication-')
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name)
        root, stage = base / 'remote', base / 'stage'
        (root / '.incoming').mkdir(parents=True)
        (root / 'releases' / 'previous').mkdir(parents=True)
        previous_manifest = {
            'version': 'previous',
            'downloads': {
                'windowsUrl': '/downloads/old-windows.exe',
                'macosArm64Url': '/downloads/old-mac-arm64.dmg',
                'macosX64Url': '/downloads/old-mac-x64.dmg',
            },
        }
        (root / 'releases' / 'previous' / 'version.json').write_text(json.dumps(previous_manifest))
        for platform in ('mac-arm64', 'mac-x64'):
            feed = root / 'releases' / 'previous' / platform / 'latest-mac.yml'
            feed.parent.mkdir(parents=True, exist_ok=True)
            feed.write_text(f'previous feed {platform}\n')
        (root / 'current').symlink_to('releases/previous')
        stage.mkdir()
        index = {'version': self.version, 'mode': mode, 'files': []}

        def add(name, data):
            file = stage / name
            file.parent.mkdir(exist_ok=True)
            file.write_bytes(data)
            digest = base64.b64encode(hashlib.sha512(data).digest()).decode()
            index['files'].append({'path': name, 'size': len(data), 'sha512': digest})
            return digest

        selected_platforms = ('win-x64',) if mode == 'windows-only' else publisher.PLATFORMS
        for platform in selected_platforms:
            files = {}
            for extension in (('exe', 'exe.blockmap') if platform == 'win-x64' else ('dmg',)):
                name = f'fixture-{self.version}-{platform}.{extension}'
                files[name] = add(platform + '/' + name, b'fixture installer')
            if platform == 'win-x64':
                add(platform + '/latest.yml', f'version: {self.version}\n'.encode())
        downloads = {'windowsUrl': f'/downloads/updates/win-x64/fixture-{self.version}-win-x64.exe'}
        if mode != 'windows-only':
            downloads.update({
                'macosArm64Url': f'/downloads/updates/mac-arm64/fixture-{self.version}-mac-arm64.dmg',
                'macosX64Url': f'/downloads/updates/mac-x64/fixture-{self.version}-mac-x64.dmg',
            })
        add('version.json', json.dumps({'version': self.version, 'downloads': downloads}).encode())
        (stage / 'release-index.json').write_text(json.dumps(index))
        if failure:
            platform = 'win-x64' if mode == 'windows-only' else 'mac-arm64'
            extension = 'exe' if mode == 'windows-only' else 'dmg'
            file = stage / platform / f'fixture-{self.version}-{platform}.{extension}'
            if failure == 'missing':
                file.unlink()
            else:
                file.write_bytes(b'tampered')
        archive = root / '.incoming' / (self.token + '.tar.gz')
        with tarfile.open(archive, 'w:gz') as bundle:
            for file in stage.rglob('*'):
                if file.is_file():
                    bundle.add(file, arcname=file.relative_to(stage))
        return root, archive

    def test_manual_mac_release_switches_download_urls_and_keeps_old_mac_update_feeds(self):
        root, archive = self.fixture()
        events = publisher.publish_archive(archive, root, self.version, self.token, 'manual-mac')
        self.assertEqual(events, ['verify-remote', 'install-immutable-artifacts', 'install-release-metadata', 'atomic-current-switch'])
        self.assertEqual((root / 'current').readlink(), Path('releases') / self.version)
        self.assertEqual(json.loads((root / 'current' / 'version.json').read_text())['version'], self.version)
        self.assertTrue((root / 'current' / 'win-x64' / 'latest.yml').is_file())
        self.assertTrue((root / 'artifacts' / 'mac-arm64' / f'fixture-{self.version}-mac-arm64.dmg').is_file())
        manifest = json.loads((root / 'current' / 'version.json').read_text())
        self.assertTrue(manifest['downloads']['macosArm64Url'].endswith(f'fixture-{self.version}-mac-arm64.dmg'))
        self.assertEqual((root / 'current' / 'mac-arm64' / 'latest-mac.yml').read_text(), 'previous feed mac-arm64\n')

    def test_corrupt_upload_keeps_previous_public_metadata(self):
        self.assert_failed_release_preserves_current('corrupt')

    def test_missing_upload_keeps_previous_public_metadata(self):
        self.assert_failed_release_preserves_current('missing')

    def test_windows_only_release_preserves_mac_manifest_and_feed_snapshots(self):
        root, archive = self.fixture(mode='windows-only')
        old_manifest = json.loads((root / 'current' / 'version.json').read_text())
        old_feeds = {
            platform: (root / 'current' / platform / 'latest-mac.yml').read_bytes()
            for platform in ('mac-arm64', 'mac-x64')
        }
        events = publisher.publish_archive(archive, root, self.version, self.token, 'windows-only')
        manifest = json.loads((root / 'current' / 'version.json').read_text())
        self.assertEqual(events, ['verify-remote', 'install-immutable-artifacts', 'install-release-metadata', 'atomic-current-switch'])
        self.assertEqual((root / 'current').readlink(), Path('releases') / self.version)
        self.assertEqual(manifest['version'], self.version)
        self.assertEqual(manifest['downloads']['windowsUrl'], f'/downloads/updates/win-x64/fixture-{self.version}-win-x64.exe')
        self.assertEqual(manifest['downloads']['macosArm64Url'], old_manifest['downloads']['macosArm64Url'])
        self.assertEqual(manifest['downloads']['macosX64Url'], old_manifest['downloads']['macosX64Url'])
        for platform, contents in old_feeds.items():
            self.assertEqual((root / 'current' / platform / 'latest-mac.yml').read_bytes(), contents)

    def test_corrupt_windows_only_payload_keeps_previous_public_metadata(self):
        self.assert_failed_windows_release_preserves_current('corrupt')

    def test_missing_windows_only_payload_keeps_previous_public_metadata(self):
        self.assert_failed_windows_release_preserves_current('missing')

    def assert_failed_windows_release_preserves_current(self, failure):
        root, archive = self.fixture(mode='windows-only', failure=failure)
        with self.assertRaises(ValueError):
            publisher.publish_archive(archive, root, self.version, self.token, 'windows-only')
        self.assertEqual((root / 'current').readlink(), Path('releases/previous'))
        self.assertEqual(json.loads((root / 'current' / 'version.json').read_text())['version'], 'previous')
        self.assertFalse((root / 'releases' / self.version).exists())

    def assert_failed_release_preserves_current(self, failure):
        root, archive = self.fixture(failure=failure)
        with self.assertRaises(ValueError):
            publisher.publish_archive(archive, root, self.version, self.token)
        self.assertEqual((root / 'current').readlink(), Path('releases/previous'))
        self.assertEqual(json.loads((root / 'current' / 'version.json').read_text())['version'], 'previous')
        self.assertFalse((root / 'releases' / self.version).exists())


if __name__ == '__main__':
    unittest.main()

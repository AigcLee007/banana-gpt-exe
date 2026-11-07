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

    def fixture(self, failure=None):
        temporary = tempfile.TemporaryDirectory(prefix='desktop-publication-')
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name)
        root, stage = base / 'remote', base / 'stage'
        (root / '.incoming').mkdir(parents=True)
        (root / 'releases' / 'previous').mkdir(parents=True)
        (root / 'releases' / 'previous' / 'version.json').write_text('{"version":"previous"}')
        (root / 'current').symlink_to('releases/previous')
        stage.mkdir()
        index = {'version': self.version, 'files': []}

        def add(name, data):
            file = stage / name
            file.parent.mkdir(exist_ok=True)
            file.write_bytes(data)
            digest = base64.b64encode(hashlib.sha512(data).digest()).decode()
            index['files'].append({'path': name, 'size': len(data), 'sha512': digest})
            return digest

        for platform in publisher.PLATFORMS:
            files = {}
            for extension in (('exe', 'exe.blockmap') if platform == 'win-x64' else ('zip', 'dmg', 'dmg.blockmap')):
                name = f'fixture-{self.version}-{platform}.{extension}'
                files[name] = add(platform + '/' + name, b'fixture installer')
            manifest = 'latest.yml' if platform == 'win-x64' else 'latest-mac.yml'
            add(platform + '/' + manifest, f'version: {self.version}\n'.encode())
            if platform != 'win-x64':
                add(platform + '/signing-verification.json', json.dumps({'version': self.version, 'platform': platform, 'signed': True, 'notarized': True, 'files': files}).encode())
        add('version.json', json.dumps({'version': self.version}).encode())
        (stage / 'release-index.json').write_text(json.dumps(index))
        if failure:
            file = stage / 'mac-arm64' / f'fixture-{self.version}-mac-arm64.zip'
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

    def test_complete_release_switches_all_metadata_last(self):
        root, archive = self.fixture()
        events = publisher.publish_archive(archive, root, self.version, self.token)
        self.assertEqual(events, ['verify-remote', 'install-immutable-artifacts', 'install-release-metadata', 'atomic-current-switch'])
        self.assertEqual((root / 'current').readlink(), Path('releases') / self.version)
        self.assertEqual(json.loads((root / 'current' / 'version.json').read_text())['version'], self.version)
        for platform in publisher.PLATFORMS:
            manifest = 'latest.yml' if platform == 'win-x64' else 'latest-mac.yml'
            self.assertTrue((root / 'current' / platform / manifest).is_file())

    def test_corrupt_upload_keeps_previous_public_metadata(self):
        self.assert_failed_release_preserves_current('corrupt')

    def test_missing_upload_keeps_previous_public_metadata(self):
        self.assert_failed_release_preserves_current('missing')

    def assert_failed_release_preserves_current(self, failure):
        root, archive = self.fixture(failure)
        with self.assertRaises(ValueError):
            publisher.publish_archive(archive, root, self.version, self.token)
        self.assertEqual((root / 'current').readlink(), Path('releases/previous'))
        self.assertEqual(json.loads((root / 'current' / 'version.json').read_text())['version'], 'previous')
        self.assertFalse((root / 'releases' / self.version).exists())


if __name__ == '__main__':
    unittest.main()

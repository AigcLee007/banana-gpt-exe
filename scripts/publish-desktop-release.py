"""Remote-side release installation. Invoked over pinned-host SSH; Python stdlib only."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile

ROOT = Path('/www/wwwroot/m.aittco.com/downloads/desktop-updates')
PLATFORMS = ('win-x64', 'mac-arm64', 'mac-x64')


def digest(path):
    hasher = hashlib.sha512()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    return base64.b64encode(hasher.digest()).decode('ascii')


def safe_directory(path):
    if path.is_symlink():
        raise ValueError('Directory must not be a symlink')
    path.mkdir(exist_ok=True)
    if not path.is_dir() or path.resolve() != path.absolute():
        raise ValueError('Directory must be a canonical absolute path')


def safe_relative(name):
    path = PurePosixPath(name)
    if '\\' in name or ':' in name or '%' in name or any(ord(c) < 32 for c in name) or path.is_absolute() or '..' in path.parts or len(path.parts) not in (1, 2):
        raise ValueError('Unsafe archive filename')
    if len(path.parts) == 2 and path.parts[0] not in PLATFORMS:
        raise ValueError('Unexpected platform')
    return str(path)


def publish_archive(archive, root, expected_version, token, expected_mode=None):
    """Verify complete upload before installing files; switch all public metadata atomically."""
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', expected_version) or not re.fullmatch(r'[a-f0-9]{24}', token):
        raise ValueError('Invalid version or upload token')
    safe_directory(root)
    incoming = root / '.incoming'
    safe_directory(incoming)
    if archive != incoming / (token + '.tar.gz') or archive.is_symlink() or not archive.is_file():
        raise ValueError('Archive must be a regular file in the expected incoming directory')
    stage = incoming / token
    stage.mkdir()  # Exclusive: never extract into an existing path.
    stage.chmod(0o755)
    events = []
    try:
        with tarfile.open(archive, 'r:gz') as bundle:
            names = set()
            for member in bundle:
                if member.isdir() and member.name in ('.', './', *PLATFORMS, *('./' + p for p in PLATFORMS)):
                    continue
                name = safe_relative(member.name.removeprefix('./'))
                if not member.isfile() or name in names:
                    raise ValueError('Archive contains a link, duplicate, or non-regular file')
                names.add(name)
                target = stage / name
                target.parent.mkdir(exist_ok=True)
                target.parent.chmod(0o755)
                with bundle.extractfile(member) as source, target.open('xb') as destination:
                    shutil.copyfileobj(source, destination)
                target.chmod(0o644)
        index = json.loads((stage / 'release-index.json').read_text())
        mode = index.get('mode', 'complete')
        if mode not in ('complete', 'windows-only') or expected_mode and mode != expected_mode:
            raise ValueError('Unexpected publication mode')
        if index['version'] != expected_version:
            raise ValueError('Archive version mismatch')
        indexed = set()
        for item in index['files']:
            name = safe_relative(item['path'])
            if name in indexed or name == 'release-index.json':
                raise ValueError('Duplicate index entry')
            indexed.add(name)
            file = stage / name
            if not file.is_file() or file.stat().st_size != item['size'] or digest(file) != item['sha512']:
                raise ValueError('Remote SHA512 or size mismatch: ' + name)
        if names != indexed | {'release-index.json'}:
            raise ValueError('Archive and index do not contain the same files')
        selected_platforms = ('win-x64',) if mode == 'windows-only' else PLATFORMS
        for platform in selected_platforms:
            manifest = 'latest.yml' if platform == 'win-x64' else 'latest-mac.yml'
            if f'{platform}/{manifest}' not in indexed:
                raise ValueError('Missing native feed')
            required = ('.exe', '.exe.blockmap') if platform == 'win-x64' else ('.zip', '.dmg')
            for extension in required:
                if not any(name.startswith(platform + '/') and name.endswith(extension) for name in indexed):
                    raise ValueError('Missing installer or update payload')
            if platform != 'win-x64':
                receipt = json.loads((stage / platform / 'signing-verification.json').read_text())
                if receipt['version'] != expected_version or receipt['platform'] != platform or receipt['signed'] is not True or receipt['notarized'] is not True:
                    raise ValueError('Missing signing verification')
                for name in indexed:
                    if name.startswith(platform + '/') and name.endswith(('.zip', '.dmg')) and receipt['files'].get(name.split('/')[1]) != digest(stage / name):
                        raise ValueError('Signing receipt does not match uploaded installer')
        legacy = json.loads((stage / 'version.json').read_text())
        if legacy['version'] != expected_version:
            raise ValueError('Legacy version mismatch')
        events.append('verify-remote')
        # Prevent concurrent SSH publishers racing the immutable-file checks and pointer switch.
        lock_path = root / '.publish.lock'
        if lock_path.is_symlink():
            raise ValueError('Lock path must not be a symlink')
        with lock_path.open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            releases, artifacts = root / 'releases', root / 'artifacts'
            safe_directory(releases)
            safe_directory(artifacts)
            release = releases / expected_version
            if release.exists() or release.is_symlink():
                raise ValueError('Version already published; use a new package version')
            current = root / 'current'
            if current.exists() or current.is_symlink():
                if not current.is_symlink() or current.resolve().parent != releases:
                    raise ValueError('Current pointer is not a release symlink')
            if mode == 'windows-only':
                previous_manifest_path = current / 'version.json'
                legacy_site_manifest = root.parent / 'version.json'
                previous_manifest = json.loads(previous_manifest_path.read_text()) if previous_manifest_path.is_file() else (
                    json.loads(legacy_site_manifest.read_text()) if legacy_site_manifest.is_file() else {}
                )
                previous_downloads = previous_manifest.get('downloads', {})
                if not isinstance(previous_downloads, dict):
                    raise ValueError('Existing download manifest is invalid')
                downloads = dict(previous_downloads)
                downloads.update(legacy.get('downloads', {}))
                legacy['downloads'] = downloads
                if not legacy.get('notes') and previous_manifest.get('notes'):
                    legacy['notes'] = previous_manifest['notes']
                for platform in ('mac-arm64', 'mac-x64'):
                    previous_feed = current / platform / 'latest-mac.yml'
                    if not previous_feed.is_file():
                        continue
                    if previous_feed.is_symlink():
                        raise ValueError('Existing Mac update feed must not be a symlink')
                    destination = stage / platform / 'latest-mac.yml'
                    destination.parent.mkdir(exist_ok=True)
                    shutil.copyfile(previous_feed, destination)
                    destination.chmod(0o644)
                    name = platform + '/latest-mac.yml'
                    indexed.add(name)
                    index['files'].append({'path': name, 'sha512': digest(destination), 'size': destination.stat().st_size})
                (stage / 'version.json').write_text(json.dumps(legacy, ensure_ascii=False, indent=2) + '\n')
                version_entry = next(item for item in index['files'] if item['path'] == 'version.json')
                version_entry['sha512'] = digest(stage / 'version.json')
                version_entry['size'] = (stage / 'version.json').stat().st_size
                (stage / 'release-index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
                indexed.add('release-index.json')
            for platform in PLATFORMS:
                if platform in selected_platforms:
                    safe_directory(artifacts / platform)
            for name in indexed:
                if '/' not in name or name.endswith(('.yml', 'signing-verification.json')):
                    continue
                if expected_version not in PurePosixPath(name).name:
                    raise ValueError('Artifact filename does not contain release version')
                destination = artifacts / name
                source = stage / name
                if destination.exists() or destination.is_symlink():
                    if destination.is_symlink() or not destination.is_file() or digest(destination) != digest(source):
                        raise ValueError('Immutable artifact collision')
                else:
                    # Rename from private staging: public paths never expose partial files.
                    os.rename(source, destination)
            events.append('install-immutable-artifacts')
            os.rename(stage, release)
            events.append('install-release-metadata')
            pointer = root / ('.current-' + token)
            pointer.symlink_to(Path('releases') / expected_version)
            os.replace(pointer, current)
            events.append('atomic-current-switch')
        return events
    finally:
        # Remove only this exclusive, verified incoming directory/archive; never recurse releases.
        if stage.exists() and stage.parent == incoming and not stage.is_symlink():
            shutil.rmtree(stage)
        archive.unlink(missing_ok=True)


if __name__ == '__main__':
    upload_token, version = sys.argv[1:3]
    mode = sys.argv[3] if len(sys.argv) > 3 else None
    result = publish_archive(ROOT / '.incoming' / (upload_token + '.tar.gz'), ROOT, version, upload_token, mode)
    print(json.dumps({'version': version, 'steps': result}))

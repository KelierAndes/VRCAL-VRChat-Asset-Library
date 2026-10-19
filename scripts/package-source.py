from pathlib import Path
import zipfile

project = Path(__file__).resolve().parent.parent
destination = project / 'outputs' / 'VRC-Asset-Library-Source.zip'
destination.parent.mkdir(exist_ok=True)
folders = ('src', 'assets', 'tests', 'scripts', 'docs', '.github')
files = ('package.json', 'package-lock.json', 'tsconfig.main.json', 'tsconfig.renderer.json', 'vite.config.mjs', 'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'GOVERNANCE.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', '.gitignore', '.gitattributes')
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in files:
        file = project / name
        archive.write(file, Path('VRChatAssetLibrary') / file.relative_to(project))
    for folder in folders:
        for file in (project / folder).rglob('*'):
            if not file.is_file() or file.is_symlink():
                continue
            parts = file.relative_to(project).parts
            if any(part.startswith('.fixtures') or part in ('node_modules', '__pycache__') for part in parts):
                continue
            archive.write(file, Path('VRChatAssetLibrary') / file.relative_to(project))
print(f'Source archive: {destination.stat().st_size:,} bytes')

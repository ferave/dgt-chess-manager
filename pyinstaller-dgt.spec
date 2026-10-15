from PyInstaller.utils.hooks import collect_submodules

hiddenimports = collect_submodules('serial')
a = Analysis(['scripts/dgt_server.py'], pathex=['.'], hiddenimports=hiddenimports)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, name='dgt_server', console=False)

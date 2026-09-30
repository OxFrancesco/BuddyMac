import json, pathlib, plistlib, subprocess, datetime
roots=[pathlib.Path('/Applications'),pathlib.Path.home()/'Applications',pathlib.Path('/Volumes/T6-7/Coding/Personal')]
apps=list(roots[0].glob('*.app'))+list(roots[1].glob('*.app'))+list(roots[2].glob('*/build/*.app'))+list(roots[2].glob('*/dist/*.app'))
rows=[]
for app in apps:
 try:
  info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
  name=info.get('CFBundleDisplayName',info.get('CFBundleName',app.stem))
  ident=info.get('CFBundleIdentifier','')
  if not any(s in (name+' '+ident).lower() for s in ['buddy','francesco','notch','keyboardclean','keyboard clean','clipboardvault','clipboard vault','timy','liny','openfit','openknowledge','lettera','speakrec','macbing','wonder','slesh','tabtab','grok bot']):continue
  usage=subprocess.run(['mdls','-name','kMDItemLastUsedDate','-name','kMDItemUseCount',str(app)],capture_output=True,text=True).stdout.strip()
  rows.append({'name':name,'bundleId':ident,'path':str(app),'version':info.get('CFBundleShortVersionString'),'usageMetadata':usage})
 except (OSError,plistlib.InvalidFileException):pass
out={'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'note':'Spotlight last-used dates are launch evidence, not a daily or weekly usage history. Ownership of unmatched apps remains unconfirmed.','apps':rows,'localRepositories':[x.name for x in roots[2].iterdir() if (x/'.git').exists()]}
pathlib.Path('evidence/app-inventory.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(rows,indent=2))

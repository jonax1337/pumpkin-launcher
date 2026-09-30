"""Prepare native system icons from approved SVGs; never installs app files."""
import base64
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import shutil
import subprocess
import sys
from zipfile import ZipFile, ZIP_DEFLATED
from PIL import Image

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/'source'
DATA=json.loads((SOURCE/'seasons.json').read_text(encoding='utf-8'))
ICO_SIZES=(16,24,32,48,64,128,256)
PNG_FILES={'32x32.png':32,'128x128.png':128,'128x128@2x.png':256}
FILES={'mark.svg','lockup.svg','icon.ico','icon.icns',*PNG_FILES}


def render_sources():
    result=subprocess.run(['node',str(SOURCE/'render-svg.cjs')],check=True,capture_output=True,text=True)
    encoded=json.loads(result.stdout)
    frames={key:{int(size):Image.open(BytesIO(base64.b64decode(png))).convert('RGBA') for size,png in sizes.items()} for key,sizes in encoded.items()}
    for v in DATA['variants']:
        assert sha256(frames[v['id']][32].tobytes()).hexdigest()==v['approvedPixelHash'],v['id']
    return frames


def verify(frames):
    checked=0
    for v in DATA['variants']:
        key=v['id']; folder=ROOT/'assets'/key; expected=frames[key]
        assert {p.name for p in folder.iterdir() if p.is_file()}==FILES,(key,'unexpected files')
        for filename,size in PNG_FILES.items():
            with Image.open(folder/filename) as image:
                assert image.size==(size,size) and image.convert('RGBA').tobytes()==expected[size].tobytes(),(key,filename)
                checked+=1
        with Image.open(folder/'icon.ico') as ico:
            assert ico.ico.sizes()=={(s,s) for s in ICO_SIZES},key
            for size in ICO_SIZES:
                assert ico.ico.getimage((size,size)).convert('RGBA').tobytes()==expected[size].tobytes(),(key,'ico',size)
                checked+=1
        with Image.open(folder/'icon.icns') as icns:
            for size in icns.info['sizes']:
                pixels=size[0]*size[2]
                assert icns.icns.getimage(size).convert('RGBA').tobytes()==expected[pixels].tobytes(),(key,'icns',size)
                checked+=1
    with Image.open(ROOT/'web/favicon.ico') as favicon:
        assert favicon.ico.sizes()=={(s,s) for s in (16,32,48)}
        for size in (16,32,48):
            assert favicon.ico.getimage((size,size)).convert('RGBA').tobytes()==frames['standard'][size].tobytes()
            checked+=1
    motion_manifest=ROOT/'motion/manifest.json'
    if motion_manifest.exists():
        motion=json.loads(motion_manifest.read_text(encoding='utf-8'))
        for key,entry in motion['seasons'].items():
            assert sha256((ROOT/'assets'/key/'mark.svg').read_bytes()).hexdigest()==entry['sourceSha256'],'Rebuild motion/build.py after changing the SVG source.'
    print(f'Validated {checked} native images against direct SVG renders; all five approved 32px designs match.')


def build():
    frames=render_sources()
    if '--check' in sys.argv:
        verify(frames); return
    manifest={'brand':DATA['brand'],'integrated':False,'sourceFormat':'SVG','calendarStatus':'proposed','variants':{},'files':{}}
    for v in DATA['variants']:
        key=v['id']; images=frames[key]; folder=ROOT/'assets'/key
        for filename,size in PNG_FILES.items(): images[size].save(folder/filename)
        images[256].save(folder/'icon.ico',sizes=[(s,s) for s in ICO_SIZES],append_images=[images[s] for s in ICO_SIZES])
        images[1024].save(folder/'icon.icns',append_images=[images[s] for s in (32,64,128,256,512,1024)])
        manifest['variants'][key]={'name':v['name'],'start':v['start'],'end':v['end'],'svg':f'assets/{key}/mark.svg','lockup':f'assets/{key}/lockup.svg','windows':f'assets/{key}/icon.ico','macos':f'assets/{key}/icon.icns','runtimePng':f'assets/{key}/32x32.png'}
    images=frames['standard']
    images[48].save(ROOT/'web/favicon.ico',sizes=[(s,s) for s in (16,32,48)],append_images=[images[s] for s in (16,32,48)])
    shutil.copyfile(ROOT/'assets/standard/mark.svg',ROOT/'web/favicon.svg')
    metadata=[{k:v[k] for k in ('id','name','label','start','end','period','note','accent')} for v in DATA['variants']]
    (ROOT/'seasons.mjs').write_text('export const SEASONS = '+json.dumps(metadata,ensure_ascii=False,indent=2)+';\n\n'+(SOURCE/'calendar.mjs').read_text(encoding='utf-8'),encoding='utf-8')
    shutil.copyfile(SOURCE/'preview.html',ROOT/'index.html')
    for directory in ('assets','web','wordmark'):
        for file in sorted((ROOT/directory).rglob('*')):
            if file.is_file(): manifest['files'][file.relative_to(ROOT).as_posix()]={'bytes':file.stat().st_size,'sha256':sha256(file.read_bytes()).hexdigest()}
    if (ROOT/'motion/manifest.json').exists():
        manifest['motion']={'manifest':'motion/manifest.json','preview':'motion/index.html'}
        for file in sorted((ROOT/'motion').rglob('*.svg')):
            manifest['files'][file.relative_to(ROOT).as_posix()]={'bytes':file.stat().st_size,'sha256':sha256(file.read_bytes()).hexdigest()}
    (ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    verify(frames)
    with ZipFile(ROOT/'pumpkin-launcher-assets.zip','w',ZIP_DEFLATED) as archive:
        for file in sorted(ROOT.rglob('*')):
            if file.is_file() and file.suffix!='.zip' and '__pycache__' not in file.parts and 'qa' not in file.relative_to(ROOT).parts:
                archive.write(file,file.relative_to(ROOT))
    print(f'Prepared {len(manifest["files"])} assets; SVG for UI, native formats only for system use.')


if __name__=='__main__':
    build()

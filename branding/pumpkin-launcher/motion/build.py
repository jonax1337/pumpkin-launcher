"""SVG mascot reactions from the approved SVGs. Pixel Art Studio timing and drawing."""
from collections import defaultdict
from hashlib import sha256
from html import escape
import json
import os
from pathlib import Path
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED
from PIL import Image, ImageColor, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent
BRAND=ROOT.parent
SKILL=Path(os.environ.get('PIXEL_ART_STUDIO_PATH',str(Path.home()/'.codex/skills/pixel-art-studio')))
sys.path.insert(0,str(SKILL/'scripts'))
from pixelstudio import Sprite

SEASONS=json.loads((BRAND/'source/seasons.json').read_text(encoding='utf-8'))['variants']
INK='#2B2433'; BODY='#E9904D'; LIGHT='#F8BD72'; PALE='#FFF2D9'; SHADOW='#784153'
CELL=48; ORIGIN=(8,8)


def p(ms,**pose): return {'ms':ms,**pose}


MOTIONS=[
    dict(id='idle',name='Schweben & Blinzeln',loop=True,use='Ruhige Präsenz, etwa auf Start- oder Leerseiten.',frames=[
        p(800),p(400,y=-1,leaf=1),p(120,y=-1,eyes='closed',leaf=1),p(120,y=-1),p(400),p(480,y=1,leaf=-1),p(880)]),
    dict(id='hello',name='Hallo!',loop=False,use='Begrüßung, Onboarding oder ein einmaliger freundlicher Hinweis.',frames=[
        p(180),p(100,y=1),p(100,y=-1,hand=1),p(140,y=-2,hand=2,leaf=-1),p(140,y=-2,hand=3,eyes='happy'),p(140,y=-2,hand=2,eyes='happy',leaf=1),p(140,y=-2,hand=3,eyes='happy'),p(140,y=-1,hand=1),p(120,y=1,eyes='closed'),p(300)]),
    dict(id='loading',name='Ich bin dran',loop=True,use='Warten auf Daten oder Vorbereiten eines Starts.',frames=[
        p(320,dots=1),p(320,eyes='left',dots=1,leaf=-1),p(320,eyes='left',dots=2,y=-1),p(160,eyes='closed',dots=2,y=-1),p(320,eyes='right',dots=3,y=-1,leaf=1),p(320,eyes='right',dots=3),p(320,dots=1)]),
    dict(id='success',name='Geschafft!',loop=False,use='Erfolgreicher Download, abgeschlossene Einrichtung oder fertige Aufgabe.',frames=[
        p(160),p(120,y=1,eyes='closed'),p(80,y=-2,arms=True,eyes='happy'),p(180,y=-4,arms=True,eyes='happy',confetti=1,leaf=-1),p(180,y=-4,arms=True,eyes='happy',confetti=2),p(140,y=-2,arms=True,eyes='happy',confetti=3,leaf=1),p(120,y=1,eyes='closed',confetti=4),p(180,eyes='happy'),p(300)]),
    dict(id='oops',name='Ups …',loop=False,use='Sanfte Reaktion bei einem fehlgeschlagenen Vorgang.',frames=[
        p(160),p(120,eyes='worried'),p(100,x=-2,eyes='worried',leaf=1),p(100,x=2,eyes='worried',leaf=-1),p(120,x=-1,eyes='worried'),p(120,x=1,eyes='worried'),p(180,eyes='closed'),p(280)]),
    dict(id='sleep',name='Kleine Pause',loop=True,use='Inaktivität oder eine ruhige, optionale Wartesituation.',frames=[
        p(560,eyes='sleep'),p(480,eyes='sleep',y=1,z=1),p(480,eyes='sleep',y=1,z=2,leaf=-1),p(480,eyes='sleep',z=3),p(560,eyes='sleep',leaf=1),p(560,eyes='sleep')]),
]


def load_svg(season):
    path=BRAND/'assets'/season['id']/'mark.svg'
    root=ET.parse(path).getroot()
    assert root.attrib['viewBox']=='0 0 32 32'
    image=Image.new('RGBA',(32,32))
    for node in root:
        kind=node.tag.rsplit('}',1)[-1]
        if kind=='title': continue
        assert kind=='rect' and node.attrib['width']=='1' and node.attrib['height']=='1'
        image.putpixel((int(node.attrib['x']),int(node.attrib['y'])),ImageColor.getrgb(node.attrib['fill'])+(255,))
    assert sha256(image.tobytes()).hexdigest()==season['approvedPixelHash'],season['id']
    return image


def face(image,expression):
    if not expression: return image.copy()
    result=image.copy(); d=ImageDraw.Draw(result)
    # Reuse the actual skin color above each eye; do not replace cheeks or costume.
    for x0,x1 in [(8,14),(17,23)]:
        for x in range(x0,x1+1):
            skin=image.getpixel((x,15))
            if skin[:3] not in [(248,189,114),(233,144,77),(255,229,172)]:
                skin=ImageColor.getrgb(LIGHT if x<15 else BODY)+(255,)
            for y in range(16,21):
                color=image.getpixel((x,y))
                if color[:3] in (ImageColor.getrgb(INK),ImageColor.getrgb(PALE)):
                    result.putpixel((x,y),skin)
    if expression in ('closed','sleep'):
        d.line((10,18,12,18),fill=INK); d.line((19,18,21,18),fill=INK)
    elif expression=='happy':
        for x in (9,18):
            d.line((x,18,x+1,17),fill=INK); d.line((x+1,17,x+3,17),fill=INK); d.point((x+4,18),fill=INK)
    else:
        shift=-1 if expression=='left' else 1 if expression=='right' else 0
        for x in (10+shift,19+shift):
            d.rectangle((x,16,x+2,19),fill=INK); d.point((x,16),fill=PALE)
    if expression in ('worried','sleep','happy'):
        d.rectangle((13,21,18,23),fill=LIGHT)
        if expression=='worried': d.rectangle((15,21,16,23),fill=INK)
        elif expression=='sleep': d.line((15,22,16,22),fill=INK)
        else:
            d.polygon([(13,21),(18,21),(17,23),(14,23)],fill=INK)
            d.line((14,21,17,21),fill=PALE)
    return result


def hand(s,x,y,left=False):
    flip=lambda px:31-px if left else px
    s.line(flip(25)+x,21+y,flip(29)+x,y+17,INK)
    s.line(flip(26)+x,21+y,flip(30)+x,y+17,BODY)
    shape=[(28,17),(28,14),(29,14),(29,12),(31,12),(31,13),(33,13),(34,15),(33,18),(30,19)]
    s.polygon([(flip(a)+x,b+y) for a,b in shape],INK)
    palm=[(29,15),(30,15),(30,13),(31,13),(31,14),(32,14),(33,15),(32,17),(30,18),(29,17)]
    s.polygon([(flip(a)+x,b+y) for a,b in palm],BODY)
    s.line(flip(30)+x,13+y,flip(31)+x,14+y,LIGHT)


def frame(image,season,pose):
    s=Sprite(CELL,CELL)
    shaped=face(image,pose.get('eyes'))
    dx=ORIGIN[0]+pose.get('x',0); dy=ORIGIN[1]+pose.get('y',0)
    limit=8 if season['id']=='halloween' else 6 if season['id']=='winter' else 9
    for y in range(32):
        for x in range(32):
            color=shaped.getpixel((x,y))
            if color[3]: s.px(x+dx+(pose.get('leaf',0) if y<=limit else 0),y+dy,color)
    if pose.get('hand'):
        phase=pose['hand']; hand(s,dx+(1 if phase==3 else 0),dy+(3 if phase==1 else 0))
    if pose.get('arms'):
        hand(s,dx,dy-1); hand(s,dx,dy-1,True)
    if pose.get('dots'):
        for i,x in enumerate((18,23,28)):
            s.rect(x,3,x+1,4,PALE if i<pose['dots'] else '#33415C')
    if pose.get('confetti'):
        positions={1:[(14,12),(33,12),(22,7)],2:[(9,8),(38,8),(22,3)],3:[(5,14),(40,14),(20,4)],4:[(5,22),(40,22),(18,7)]}[pose['confetti']]
        target=ImageColor.getrgb(season['accent'])
        palette={pixel[:3] for pixel in image.get_flattened_data() if pixel[3]}
        accent=min(palette,key=lambda rgb:sum((a-b)**2 for a,b in zip(rgb,target)))
        for (x,y),color in zip(positions,[LIGHT,accent+(255,),PALE]): s.rect(x,y,x+1,y+1,color)
    if pose.get('z'):
        x,y={1:(36,14),2:(38,10),3:(40,6)}[pose['z']]
        s.line(x,y,x+3,y,'#A9B4C8'); s.px(x+2,y+1,'#A9B4C8'); s.px(x+1,y+2,'#A9B4C8'); s.line(x,y+3,x+3,y+3,'#A9B4C8')
    return s.composite(1)


def paths(image):
    colors=defaultdict(list)
    for y in range(CELL):
        x=0
        while x<CELL:
            color=image.getpixel((x,y)); end=x+1
            while end<CELL and image.getpixel((end,y))==color: end+=1
            if color[3]:
                hex_color='#%02X%02X%02X'%color[:3]
                colors[hex_color].append(f'M{x} {y}h{end-x}v1h{x-end}z')
            x=end
    return ''.join(f'<path fill="{color}" d="{"".join(runs)}"/>' for color,runs in colors.items())


def svg_animation(season,motion,frames,poster):
    duration=sum(p['ms'] for p in motion['frames'])
    prefix=season['id']+'-'+motion['id']
    definitions=[]; uses=[]; ids={}; cursor=0
    for i,(im,pose) in enumerate(zip(frames,motion['frames'])):
        digest=sha256(im.tobytes()).hexdigest()
        if digest not in ids:
            identifier=f'{prefix}-pose-{len(ids)}'; ids[digest]=identifier
            definitions.append(f'<g id="{identifier}">{paths(im)}</g>')
        start=cursor/duration; cursor+=pose['ms']; end=cursor/duration
        if i==0: times=[0,end,1]; values=['visible','hidden','hidden']
        elif i==len(frames)-1: times=[0,start,1]; values=['hidden','visible','visible']
        else: times=[0,start,end,1]; values=['hidden','visible','hidden','hidden']
        uses.append(f'<g data-frame="{i}" visibility="hidden"><use href="#{ids[digest]}"/><animate attributeName="visibility" calcMode="discrete" values="{";".join(values)}" keyTimes="{";".join(f"{t:.7f}" for t in times)}" dur="{duration}ms" repeatCount="{"indefinite" if motion["loop"] else "1"}" fill="freeze"/></g>')
    style='.pm-poster{display:none}.is-static .pm-frames{display:none}.is-static .pm-poster{display:inline}@media(prefers-reduced-motion:reduce){.pm-frames{display:none}.pm-poster{display:inline}}'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 48 48" shape-rendering="crispEdges" role="img" data-duration-ms="{duration}" data-loop="{str(motion["loop"]).lower()}"><title>{escape(season["name"]+" · "+motion["name"])}</title><style>{style}</style><defs>{"".join(definitions)}</defs><g class="pm-poster">{paths(poster)}</g><g class="pm-frames">{"".join(uses)}</g></svg>\n'


def contact_sheet(all_frames):
    canvas=Image.new('RGB',(1440,870),'#070A11'); d=ImageDraw.Draw(canvas)
    font=lambda size:ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf',size)
    for row,motion in enumerate(MOTIONS):
        d.text((20,row*140+14),motion['name'],font=font(18),fill='#E39860')
        frames=all_frames['standard'][motion['id']]
        for i,image in enumerate(frames):
            scaled=image.resize((96,96),Image.Resampling.NEAREST)
            canvas.paste(scaled,(220+i*100,row*140+15),scaled)
            d.text((220+i*100,row*140+113),str(motion['frames'][i]['ms'])+' ms',font=font(12),fill='#A9B4C8')
    canvas.save(ROOT/'qa/contact-sheet.png')


def preview_gif(all_frames):
    pictures=[]
    font=ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf',22)
    for t in range(0,12000,100):
        canvas=Image.new('RGB',(768,576),'#070A11'); d=ImageDraw.Draw(canvas)
        for i,motion in enumerate(MOTIONS):
            duration=sum(p['ms'] for p in motion['frames'])
            phase=t%(duration+(0 if motion['loop'] else 900)); cursor=0; index=len(motion['frames'])-1
            for j,pose in enumerate(motion['frames']):
                cursor+=pose['ms']
                if phase<cursor: index=j; break
            frame=all_frames['standard'][motion['id']][index].resize((192,192),Image.Resampling.NEAREST)
            x=(i%3)*256+32; y=(i//3)*288+22
            canvas.paste(frame,(x,y),frame)
            d.text((x+96,y+208),motion['name'],anchor='mt',font=font,fill='#F6E7C8')
        pictures.append(canvas)
    pictures[0].save(ROOT/'buddy-motion-preview.gif',save_all=True,append_images=pictures[1:],duration=100,loop=0,optimize=False,disposal=2)


def season_sheet(all_frames):
    canvas=Image.new('RGB',(1080,1080),'#070A11'); d=ImageDraw.Draw(canvas)
    font=ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf',17)
    for col,season in enumerate(SEASONS):
        d.text((180+col*178,20),season['name'],font=font,fill='#E39860')
        for row,(motion,index) in enumerate(zip(MOTIONS,[2,4,4,4,3,3])):
            im=all_frames[season['id']][motion['id']][index].resize((144,144),Image.Resampling.NEAREST)
            canvas.paste(im,(180+col*178,60+row*166),im)
            if col==0:d.text((15,115+row*166),motion['name'],font=font,fill='#A9B4C8')
    canvas.save(ROOT/'qa/season-poses.png')


def build():
    (ROOT/'qa').mkdir(exist_ok=True)
    all_frames={}; manifest={'format':'animated-svg','viewBox':[0,0,48,48],'origin':[8,8],'sourceGrid':[32,32],'integrated':False,'seasons':{},'motions':[]}
    for motion in MOTIONS:
        manifest['motions'].append({k:v for k,v in motion.items() if k!='frames'}|{'durationMs':sum(p['ms'] for p in motion['frames']),'frames':len(motion['frames'])})
    for season in SEASONS:
        image=load_svg(season); key=season['id']; folder=ROOT/key; folder.mkdir(exist_ok=True)
        poster=frame(image,season,{})
        assert poster.crop((8,8,40,40)).tobytes()==image.tobytes()
        (folder/'poster.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" shape-rendering="crispEdges"><title>{escape(season["name"])}</title>{paths(poster)}</svg>\n',encoding='utf-8')
        all_frames[key]={}; files={}
        for motion in MOTIONS:
            frames=[frame(image,season,pose) for pose in motion['frames']]
            assert all(p['ms']>=80 for p in motion['frames'])
            for im in frames:
                assert im.size==(48,48)
                assert all(pixel[3] in (0,255) for pixel in im.get_flattened_data())
                assert len({pixel[:3] for pixel in im.get_flattened_data() if pixel[3]})<=12,(key,motion['id'],'palette')
                box=im.getbbox(); assert box and box[0]>=2 and box[1]>=2 and box[2]<=46 and box[3]<=46,(key,motion['id'],box)
            if motion['loop']: assert frames[0].tobytes()==frames[-1].tobytes(),(key,motion['id'],'seam')
            else: assert frames[-1].tobytes()==poster.tobytes(),(key,motion['id'],'return to rest')
            assert len({im.tobytes() for im in frames})>=3
            file=folder/(motion['id']+'.svg'); file.write_text(svg_animation(season,motion,frames,poster),encoding='utf-8')
            all_frames[key][motion['id']]=frames
            files[motion['id']]={'svg':f'{key}/{motion["id"]}.svg','bytes':file.stat().st_size}
        manifest['seasons'][key]={'name':season['name'],'poster':f'{key}/poster.svg','sourceSha256':sha256((BRAND/'assets'/key/'mark.svg').read_bytes()).hexdigest(),'files':files}
    (ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    contact_sheet(all_frames); season_sheet(all_frames); preview_gif(all_frames)
    font=re.search(r'data:font/woff2;base64,([^)]*)',(BRAND/'source/preview.html').read_text(encoding='utf-8')).group(1)
    (ROOT/'index.html').write_text((ROOT/'source/preview.html').read_text(encoding='utf-8').replace('__FONT__',font),encoding='utf-8')
    shutil.copyfile(BRAND/'source/FONT-LICENSE.txt',ROOT/'FONT-LICENSE.txt')
    with ZipFile(ROOT/'pumpkin-mascot-motion.zip','w',ZIP_DEFLATED) as archive:
        for file in sorted(ROOT.rglob('*')):
            if file.is_file() and file.suffix!='.zip' and 'qa' not in file.parts and '__pycache__' not in file.parts:
                archive.write(file,file.relative_to(ROOT))
    print('Built and validated 30 animated SVGs + 5 static posters. Static brand assets unchanged.')


if __name__=='__main__': build()

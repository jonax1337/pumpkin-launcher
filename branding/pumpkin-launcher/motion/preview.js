const manifest = await (await fetch('./manifest.json')).json();
const media = matchMedia('(prefers-reduced-motion: reduce)');
const pause = document.getElementById('pause');
const repeat = document.getElementById('repeat');
const reduce = document.getElementById('reduce');
const status = document.getElementById('status');
const entries = [];
let season = 'standard';
let paused = false;
const esc = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

function apply(entry) {
  if (!entry.root) return;
  const reduced = reduce.checked || media.matches;
  entry.root.classList.toggle('is-static', reduced);
  if (paused || reduced || entry.scrubbing || !entry.visible || document.hidden) entry.root.pauseAnimations();
  else entry.root.unpauseAnimations();
}
function update() {
  entries.forEach(apply);
  entries.forEach(entry=>{entry.card.querySelector('button').textContent=paused?'Zum Anfang':'Neu abspielen';});
  pause.textContent = paused ? 'Weiter abspielen' : 'Alle pausieren';
  status.textContent = (reduce.checked || media.matches) ? 'Statische Ansicht · Bewegung reduziert' : paused ? 'Pausiert · die Zeitregler bleiben bedienbar' : 'SVG-Animationen laufen · zum Prüfen kannst du jede Bewegung anhalten oder verschieben';
}
function restart(entry) {
  if (!entry.root) return;
  entry.scrubbing = false;
  entry.root.setCurrentTime(0);
  apply(entry);
}
function changeSeason(id) {
  season = id;
  document.querySelectorAll('.season').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.season===id)));
  for (const entry of entries) {
    entry.root = null;
    entry.scrubbing = false;
    entry.object.data = `${id}/${entry.motion.id}.svg`;
    entry.download.href = `${id}/${entry.motion.id}.svg`;
  }
}

for (const [id, details] of Object.entries(manifest.seasons)) {
  const button=document.createElement('button');
  button.type='button'; button.className='season'; button.dataset.season=id;
  button.setAttribute('aria-pressed',String(id===season));
  button.innerHTML=`<img src="${details.poster}" alt=""><span>${esc(details.name)}</span>`;
  button.addEventListener('click',()=>changeSeason(id));
  document.getElementById('seasons').append(button);
}

const orderedMotions=[...manifest.motions].sort((a,b)=>Number(Boolean(b.new))-Number(Boolean(a.new)));
for (const [i,motion] of orderedMotions.entries()) {
  const card=document.createElement('article'); card.className='card'; card.dataset.motion=motion.id;
  card.innerHTML=`<div class="card-top"><span class="number">${String(i+1).padStart(2,'0')}</span><span class="badge">${motion.new?'Neu · ':''}${motion.loop?'Schleife':'Einmal'} · ${(motion.durationMs/1000).toFixed(2)} s</span></div><div class="stage"><object type="image/svg+xml" aria-label="${esc(motion.name)}" data="standard/${motion.id}.svg"><img src="standard/poster.svg" alt="Buddy"></object></div><h2>${esc(motion.name)}</h2><p class="description">${esc(motion.use)}</p><div class="scrub"><input type="range" min="0" max="${motion.durationMs}" step="20" value="0" aria-label="Zeitposition ${esc(motion.name)}"><output>0.00 s</output></div><div class="actions"><button type="button">Neu abspielen</button><a download href="standard/${motion.id}.svg">SVG herunterladen</a></div>`;
  const entry={card,motion,object:card.querySelector('object'),download:card.querySelector('a'),slider:card.querySelector('input'),output:card.querySelector('output'),root:null,scrubbing:false,visible:true};
  entry.object.addEventListener('load',()=>{
    entry.root=entry.object.contentDocument?.documentElement;
    if (!entry.root?.setCurrentTime) { entry.root=null; return; }
    entry.root.setCurrentTime(0); apply(entry);
  });
  entry.slider.addEventListener('input',()=>{
    entry.scrubbing=true;
    entry.root?.setCurrentTime(Number(entry.slider.value)/1000);
    entry.output.textContent=(Number(entry.slider.value)/1000).toFixed(2)+' s';
    apply(entry);
  });
  card.querySelector('button').addEventListener('click',()=>restart(entry));
  entries.push(entry); document.getElementById('cards').append(card);
}

const observer=new IntersectionObserver(changes=>{
  for (const change of changes) {
    const entry=entries.find(e=>e.card===change.target);
    entry.visible=change.isIntersecting; apply(entry);
  }
});
entries.forEach(entry=>observer.observe(entry.card));
pause.addEventListener('click',()=>{paused=!paused; update();});
document.getElementById('replay').addEventListener('click',()=>{paused=false;entries.forEach(restart);update();});
reduce.addEventListener('change',update);
media.addEventListener('change',update);
document.addEventListener('visibilitychange',update);
setInterval(()=>{
  if (document.hidden) return;
  for (const entry of entries) {
    if (!entry.root || !entry.visible || entry.scrubbing) continue;
    let time=entry.root.getCurrentTime();
    const seconds=entry.motion.durationMs/1000;
    if (!paused && !reduce.checked && !media.matches && repeat.checked && !entry.motion.loop && time>=seconds+1) {
      entry.root.setCurrentTime(0); time=0;
    }
    const displayed=entry.motion.loop ? time%seconds : Math.min(time,seconds);
    entry.slider.value=String(Math.round(displayed*1000));
    entry.output.textContent=displayed.toFixed(2)+' s';
  }
},100);
update();

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

const api = {
  async get(path, params) {
    const url = new URL(path, location.origin);
    if (params) Object.entries(params).forEach(([k,v])=>url.searchParams.set(k, v));
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.headers.get('content-type')?.includes('application/json') ? res.json() : res.text();
  },
  async post(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body||{}) });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async del(path) {
    const res = await fetch(path, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
}

async function health() {
  try {
    const r = await api.get('/api/health');
    $('#healthDot').className = 'inline-block w-2 h-2 rounded-full bg-emerald-500';
    $('#healthText').textContent = 'Bereit';
  } catch {
    $('#healthDot').className = 'inline-block w-2 h-2 rounded-full bg-red-500';
    $('#healthText').textContent = 'Fehler';
  }
}

function formatStatus(c) {
  const running = c.State === 'running' || c.State === 'Up' || c.Status?.startsWith('Up');
  return { running, text: c.State || c.Status || '' };
}

function renderContainers(list) {
  const host = $('#containers');
  host.innerHTML = '';
  const tpl = $('#containerRow');
  list.forEach(c => {
    const el = tpl.content.firstElementChild.cloneNode(true);
    const name = c.Names?.[0]?.replace(/^\//,'') || c.Names || c.Id.slice(0,12);
    el.querySelector('.name').textContent = name;
    el.querySelector('.id').textContent = c.Image + ' • ' + c.Id.slice(0,12);
    const s = formatStatus(c);
    const badge = el.querySelector('.status');
    badge.textContent = s.text;
    badge.className = 'px-2 py-0.5 rounded text-xs status ' + (s.running ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600');
    el.querySelector('.start').classList.toggle('hidden', s.running);
    el.querySelector('.stop').classList.toggle('hidden', !s.running);
    el.querySelector('.start').addEventListener('click', async ()=>{ await api.post(`/api/docker/containers/${c.Id}/start`); await refreshContainers(); });
    el.querySelector('.stop').addEventListener('click', async ()=>{ await api.post(`/api/docker/containers/${c.Id}/stop`); await refreshContainers(); });
    el.querySelector('.restart').addEventListener('click', async ()=>{ await api.post(`/api/docker/containers/${c.Id}/restart`); await refreshContainers(); });
    el.querySelector('.remove').addEventListener('click', async ()=>{ if(confirm('Container entfernen?')){ await api.del(`/api/docker/containers/${c.Id}`); await refreshContainers(); } });
    el.querySelector('.logs').addEventListener('click', async ()=>{
      const txt = await api.get(`/api/docker/containers/${c.Id}/logs`, { tail: 200 });
      const w = window.open('', '_blank');
      w.document.write(`<pre style="white-space:pre-wrap">${txt.replace(/[&<>]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m]))}</pre>`);
    });
    host.appendChild(el);
  });
}

async function refreshContainers() {
  const all = $('#toggleAll').checked ? '1' : '0';
  const r = await api.get('/api/docker/containers?all=' + all);
  renderContainers(r.containers || []);
}

function renderImages(images) {
  const host = $('#images');
  host.innerHTML = '';
  images.forEach(img => {
    const repoTags = img.RepoTags || [];
    const line = document.createElement('div');
    line.className = 'p-3 text-sm flex items-center gap-3';
    line.innerHTML = `<div class="grow">${repoTags.join(', ') || '<span class=\'text-slate-400\'>(unbenannt)</span>'}</div><div class="text-slate-500">${(img.Size/1024/1024).toFixed(1)} MB</div>`;
    host.appendChild(line);
  });
}

async function refreshImages() {
  const r = await api.get('/api/docker/images');
  renderImages(r.images || []);
}

function wirePullForm() {
  $('#pullForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const image = $('#pullImage').value.trim();
    if (!image) return;
    const btn = $('#pullForm button');
    btn.disabled = true; btn.textContent = 'Pull…';
    try { await api.post('/api/docker/images/pull', { image }); await refreshImages(); }
    catch (err) { alert('Fehler: ' + err.message); }
    finally { btn.disabled = false; btn.textContent = 'Pull'; }
  });
}

function wireToggleAll() { $('#toggleAll').addEventListener('change', refreshContainers); }

function wireUpload() {
  const dz = $('#dropZone');
  const fi = $('#fileInput');
  dz.addEventListener('click', ()=> fi.click());
  dz.addEventListener('dragover', (e)=>{ e.preventDefault(); dz.classList.add('border-brand-600'); });
  dz.addEventListener('dragleave', ()=> dz.classList.remove('border-brand-600'));
  dz.addEventListener('drop', (e)=>{ e.preventDefault(); dz.classList.remove('border-brand-600'); handleFiles(e.dataTransfer.files); });
  fi.addEventListener('change', ()=> handleFiles(fi.files));

  async function handleFiles(fileList) {
    const ul = $('#uploadList');
    const li = (text)=>{ const el=document.createElement('li'); el.textContent=text; ul.appendChild(el); return el; };
    if (!fileList || !fileList.length) return;
    const fd = new FormData();
    Array.from(fileList).forEach(f => fd.append('files', f));
    const item = li('Lade hoch…');
    try {
      const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      item.innerHTML = 'Hochgeladen: ' + data.files.map(f=>`<a class="text-brand-600 underline" href="${f.path}" target="_blank">${f.original}</a>`).join(', ');
    } catch (e) {
      item.textContent = 'Fehler: ' + e.message;
    }
  }
}

async function refreshGit() {
  const el = $('#gitStatus');
  el.textContent = 'Lade…';
  try {
    const r = await api.get('/api/git/status');
    if (!r.repo) { el.textContent = 'Kein Git-Repository.'; return; }
    el.innerHTML = `Branch <b>${r.branch}</b>${r.upstream? ' ↔ '+r.upstream: ''}<br>`+
      `Ahead: ${r.ahead}, Behind: ${r.behind}`;
    if (r.behind > 0) {
      const btn = document.createElement('button');
      btn.className = 'ml-2 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded px-2 py-1';
      btn.textContent = 'Pull';
      btn.onclick = async ()=>{ btn.disabled = true; btn.textContent='Pull…'; try { await api.post('/api/git/pull'); await refreshGit(); } finally { btn.disabled=false; btn.textContent='Pull'; } };
      el.appendChild(btn);
    }
  } catch (e) {
    el.textContent = 'Fehler: ' + e.message;
  }
}

$('#refreshGit')?.addEventListener('click', refreshGit);

(async function init(){
  wirePullForm();
  wireToggleAll();
  wireUpload();
  await health();
  await Promise.all([refreshContainers(), refreshImages(), refreshGit()]);
})();

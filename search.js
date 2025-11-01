
/* Site-wide search for quimicaDatos (groups 1..23)
   - Fetches and indexes ./cuadro/grupo-XX.html on first use
   - Opens an overlay with results when the user presses Enter in the .search-bar
*/
(function(){
  const GROUPS = [
    [1,"Analgesia"],[2,"Anestesia"],[3,"Cardiología"],[4,"Dermatología"],
    [5,"Endocrinología y Metabolismo"],[6,"Enfermedades Infecciosas y Parasitarias"],
    [7,"Enfermedades Inmunoalérgicas"],[8,"GASTROENTEROLOGIA"],[9,"GINECO-ABSTINENCIA"],
    [10,"HEMATOLOGIA"],[11,"INTOXICACIONES"],[12,"NEFROLOGIA Y UROLOGIA"],
    [13,"Neumología"],[14,"Neurología"],[15,"Nutriología"],[16,"Oftalmología"],
    [17,"Oncología"],[18,"Otorrinolaringología"],[19,"Planificación Familiar"],
    [20,"Psiquiatría"],[21,"Reumatología y Traumatología"],
    [22,"Soluciones Electrolíticas y Sustitutos del Plasma"],
    [23,"Vacunas, Toxoides, Inmunoglobulinas y Antitoxinas"]
  ].map(([n,t])=>({n,t,href:`./cuadro/grupo-${String(n).padStart(2,"0")}.html`}));

  const ACCENT_MAP = {
    'á':'a','é':'e','í':'i','ó':'o','ú':'u','ü':'u','ñ':'n',
    'Á':'a','É':'e','Í':'i','Ó':'o','Ú':'u','Ü':'u','Ñ':'n'
  };
  const norm = s => (s||"").replace(/[ÁÉÍÓÚÜáéíóúüÑñ]/g, m=>ACCENT_MAP[m]||m)
                            .toLowerCase()
                            .replace(/\s+/g,' ')
                            .trim();

  let overlay, input, list, countEl, loadingEl;
  let indexBuilt = false;
  let docs = []; // {groupN, groupT, url, text, raw}

  function ensureUI(){
    if (document.getElementById('qsearch-overlay')) return;
    const wrap = document.createElement('div');
    wrap.id = 'qsearch-overlay';
    wrap.innerHTML = `
      <div class="qs-backdrop"></div>
      <div class="qs-panel">
        <div class="qs-head">
          <input id="qs-input" type="search" placeholder="Buscar (ej. via oral, grupo:Cardiología, analgesia)"/>
          <button id="qs-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="qs-info"><span id="qs-count">0</span> resultados</div>
        <div class="qs-body">
          <div id="qs-loading">Indexando grupos…</div>
          <ul id="qs-list"></ul>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    overlay = wrap;
    input = wrap.querySelector('#qs-input');
    list = wrap.querySelector('#qs-list');
    countEl = wrap.querySelector('#qs-count');
    loadingEl = wrap.querySelector('#qs-loading');

    wrap.querySelector('#qs-close').addEventListener('click', hide);
    wrap.querySelector('.qs-backdrop').addEventListener('click', hide);
    input.addEventListener('input', onQuery);
    input.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape') hide();
    });
  }

  function show(){
    ensureUI();
    overlay.classList.add('open');
    input.focus();
    if (!indexBuilt) buildIndex();
  }
  function hide(){
    if (!overlay) return;
    overlay.classList.remove('open');
  }

  async function buildIndex(){
    indexBuilt = true;
    loadingEl.style.display = 'block';
    list.innerHTML = '';
    countEl.textContent = '0';

    const parser = new DOMParser();
    for (const g of GROUPS){
      try{
        const res = await fetch(g.href);
        const html = await res.text();
        const doc = parser.parseFromString(html, 'text/html');
        const titleEl = doc.querySelector('h1.title') || doc.querySelector('h1') || {textContent:g.t};
        const chunks = [titleEl.textContent];
        doc.querySelectorAll('table').forEach(tb => chunks.push(tb.innerText || tb.textContent || ''));
        doc.querySelectorAll('p, li').forEach(el => chunks.push(el.innerText || el.textContent || ''));
        const raw = chunks.join('\n');
        docs.push({groupN:g.n, groupT:g.t, url:g.href, text:norm(raw), raw});
      }catch(err){
        console.warn('Search indexing failed for', g.href, err);
      }
    }
    loadingEl.style.display = 'none';
    if (input.value.trim()) onQuery();
  }

  function parseQuery(q){
    const terms = [];
    let groupFilter = null;
    const parts = (q.match(/"[^"]+"|\S+/g) || []);
    parts.forEach(p=>{
      if (p.toLowerCase().startsWith('grupo:')){
        groupFilter = norm(p.split(':').slice(1).join(':').replace(/^"|"$/g,''));
      } else {
        terms.push(norm(p.replace(/^"|"$/g,'')));
      }
    });
    return {terms: terms.filter(Boolean), groupFilter};
  }

  function scoreDoc(d, {terms, groupFilter}){
    if (groupFilter && !norm(d.groupT).includes(groupFilter)) return 0;
    if (!terms.length) return 0;
    let s = 0;
    for (const t of terms){
      if (!t) continue;
      const idx = d.text.indexOf(t);
      if (idx >= 0){
        s += 5;
        if (norm(d.groupT).includes(t)) s += 5;
        if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(d.text)) s += 3;
      }
    }
    return s;
  }

  function buildSnippet(raw, terms){
    const txt = raw.replace(/\s+/g,' ').trim();
    const ntx = norm(txt);
    let pos = -1;
    for (const t of terms){
      const i = ntx.indexOf(t);
      if (i >= 0) { pos = i; break; }
    }
    if (pos < 0) return txt.slice(0,160) + (txt.length>160?'…':'');
    const start = Math.max(0, pos - 60);
    const end = Math.min(ntx.length, pos + 160);
    let snippet = txt.slice(start, end);
    terms.forEach(t=>{
      if (!t) return;
      const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      snippet = snippet.replace(re, m=>`<mark>${m}</mark>`);
    });
    return (start>0?'…':'') + snippet + (end<ntx.length?'…':'');
  }

  function onQuery(){
    const q = input.value || '';
    if (!indexBuilt) return;
    const {terms, groupFilter} = parseQuery(q);
    const results = [];
    for (const d of docs){
      const sc = scoreDoc(d, {terms, groupFilter});
      if (sc>0){
        results.push({doc:d, score:sc, snippet:buildSnippet(d.raw, terms)});
      }
    }
    results.sort((a,b)=> b.score - a.score || a.doc.groupN - b.doc.groupN);
    list.innerHTML = results.map(r=>`
      <li class="qs-item">
        <div class="qs-meta">Grupo Nº ${r.doc.groupN} — ${r.doc.groupT}</div>
        <div class="qs-snippet">${r.snippet}</div>
        <a class="qs-link" href="${r.doc.url}" target="_blank" rel="noopener">Abrir recuadro</a>
      </li>`).join('');
    document.getElementById('qs-count').textContent = String(results.length);
  }

  function attachToSearchBars(){
    document.querySelectorAll('input.search-bar').forEach(inp=>{
      inp.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter'){
          e.preventDefault();
          ensureUI();
          // preload query from header input
          input.value = inp.value;
          show();
          onQuery();
        }
      });
    });
  }

  function injectCSS(){
    if (document.getElementById('qsearch-css')) return;
    const style = document.createElement('style');
    style.id = 'qsearch-css';
    style.textContent = `
      #qsearch-overlay{position:fixed;inset:0;display:none;z-index:9999}
      #qsearch-overlay.open{display:block}
      #qsearch-overlay .qs-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35)}
      #qsearch-overlay .qs-panel{position:absolute;inset:5% 8% auto 8%;background:#fff;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.25);max-height:90%;display:flex;flex-direction:column}
      #qsearch-overlay .qs-head{display:flex;gap:.5rem;padding:.8rem .9rem;border-bottom:1px solid #eee}
      #qsearch-overlay .qs-head input{flex:1;padding:.6rem .7rem;border-radius:10px;border:1px solid #e3e3e7;outline:none}
      #qsearch-overlay .qs-head button{border:none;background:#7b194b;color:#fff;border-radius:10px;padding:.55rem .8rem;cursor:pointer}
      #qsearch-overlay .qs-info{padding:.4rem .9rem;color:#555;font-size:.9rem}
      #qsearch-overlay .qs-body{padding:.6rem .9rem;overflow:auto}
      #qsearch-overlay #qs-loading{padding:.6rem;color:#7b194b}
      #qsearch-overlay #qs-list{list-style:none;margin:0;padding:0;display:grid;gap:.75rem}
      #qsearch-overlay .qs-item{border:1px solid #eee;border-radius:12px;padding:.75rem .9rem}
      #qsearch-overlay .qs-meta{font-weight:700;color:#7b194b;margin-bottom:.25rem}
      #qsearch-overlay .qs-snippet{color:#2d2d2d;line-height:1.4;margin-bottom:.4rem}
      #qsearch-overlay .qs-link{display:inline-block;border:1px solid #7b194b;color:#7b194b;text-decoration:none;padding:.4rem .7rem;border-radius:10px}
      #qsearch-overlay .qs-link:hover{background:#7b194b;color:#fff}
      #qsearch-overlay mark{background:#fff3a3}
      @media (max-width: 640px){
        #qsearch-overlay .qs-panel{inset:6% 4% auto 4%}
      }`;
    document.head.appendChild(style);
  }

  window.addEventListener('DOMContentLoaded', ()=>{
    injectCSS();
    attachToSearchBars();
  });
})();

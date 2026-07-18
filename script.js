/* ============================================================
   FUELLE — TRANSCRIPTOR DE BANDONEÓN PRO v2.0
   Senior Dev Edition: Detección IA + Partitura + Exportación
   ============================================================ */

/* ================================================================
   1. TEORÍA MUSICAL: nombres en español, tonalidades, duraciones
   ================================================================ */
const SHARP_NAMES = ['Do','Do#','Re','Re#','Mi','Fa','Fa#','Sol','Sol#','La','La#','Si'];
const FLAT_NAMES  = ['Do','Reb','Re','Mib','Mi','Fa','Solb','Sol','Lab','La','Sib','Si'];
const SPOKEN_SHARP = ['Do','Do sostenido','Re','Re sostenido','Mi','Fa','Fa sostenido','Sol','Sol sostenido','La','La sostenido','Si'];
const SPOKEN_FLAT  = ['Do','Re bemol','Re','Mi bemol','Mi','Fa','Sol bemol','Sol','La bemol','La','Si bemol','Si'];
const VEX_SHARP = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'];
const VEX_FLAT  = ['c','db','d','eb','e','f','gb','g','ab','a','bb','b'];

const KEYS = [
  {label:'Do mayor',   flats:false, vex:'C'},
  {label:'Sol mayor',  flats:false, vex:'G'},
  {label:'Re mayor',   flats:false, vex:'D'},
  {label:'La mayor',   flats:false, vex:'A'},
  {label:'Mi mayor',   flats:false, vex:'E'},
  {label:'Si mayor',   flats:false, vex:'B'},
  {label:'Fa# mayor',  flats:false, vex:'F#'},
  {label:'Fa mayor',   flats:true,  vex:'F'},
  {label:'Sib mayor',  flats:true,  vex:'Bb'},
  {label:'Mib mayor',  flats:true,  vex:'Eb'},
  {label:'Lab mayor',  flats:true,  vex:'Ab'},
  {label:'Reb mayor',  flats:true,  vex:'Db'},
];

const KEY_FIFTHS = {C:0,G:1,D:2,A:3,E:4,B:5,'F#':6,F:-1,Bb:-2,Eb:-3,Ab:-4,Db:-5};

const keySelect = document.getElementById('keySelect');
KEYS.forEach((k,i)=>{
  const o = document.createElement('option');
  o.value = i; o.textContent = k.label;
  if(k.vex==='C') o.selected = true;
  keySelect.appendChild(o);
});

function currentKey(){ return KEYS[+keySelect.value]; }

const DURATION_TABLE = [
  {beats:4,    code:'w',  label:'redonda'},
  {beats:3,    code:'hd', label:'blanca con puntillo'},
  {beats:2,    code:'h',  label:'blanca'},
  {beats:1.5,  code:'qd', label:'negra con puntillo'},
  {beats:1,    code:'q',  label:'negra'},
  {beats:0.75, code:'8d', label:'corchea con puntillo'},
  {beats:0.5,  code:'8',  label:'corchea'},
  {beats:0.375,code:'16d',label:'semicorchea con puntillo'},
  {beats:0.25, code:'16', label:'semicorchea'},
  {beats:0.125,code:'32', label:'fusa'},
];

function quantizeDuration(beats){
  let best = DURATION_TABLE[0], bestDiff = Infinity;
  for(const d of DURATION_TABLE){
    const diff = Math.abs(d.beats - beats);
    if(diff < bestDiff){ bestDiff = diff; best = d; }
  }
  return best;
}

function beatsOfCode(code){ 
  const stripped = code.replace('d','');
  return {w:4,h:2,q:1,'8':0.5,'16':0.25,'32':0.125}[stripped] || 1; 
}
function typeOfXml(code){ 
  const stripped = code.replace('d','');
  return {w:'whole',h:'half',q:'quarter','8':'eighth','16':'16th','32':'32nd'}[stripped] || 'quarter'; 
}

function midiToInfo(midi, useFlats){
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const octave = Math.floor(Math.round(midi)/12) - 1;
  const names = useFlats ? FLAT_NAMES : SHARP_NAMES;
  const spoken = useFlats ? SPOKEN_FLAT : SPOKEN_SHARP;
  const vexLetter = useFlats ? VEX_FLAT[pc] : VEX_SHARP[pc];
  return { pc, octave, name: names[pc]+octave, spoken: spoken[pc], vexKey: vexLetter+'/'+octave };
}

function getMusicalInfo(midi, keyObj){
  const info = midiToInfo(midi, keyObj.flats);
  const keyRoot = keyObj.vex.replace('#','#').replace('b','b');
  const midiRoot = (keyRoot[0].charCodeAt(0) - 'C'.charCodeAt(0) + 12) % 12;
  const midiOctave = 60;
  const rootMidi = midiOctave + midiRoot;
  
  let degree = ((Math.round(midi) - rootMidi + 1200) % 12) + 1;
  const degreeNames = ['Tónica','Segunda','Tercera','Cuarta','Quinta','Sexta','Séptima'];
  const degreeLabel = degreeNames[degree - 1] || 'Intervalo';
  
  return {
    name: info.name,
    spoken: info.spoken,
    degree: degree,
    degreeLabel: degreeLabel,
    keyName: keyObj.label,
    hasAccidental: info.name.includes('#') || info.name.includes('b')
  };
}

/* ================================================================
   2. DETECCIÓN DE AUDIO: YIN MEJORADO PARA BANDONEÓN (80Hz-1200Hz)
   ================================================================ */
let audioCtx, analyser, micSource, scriptNode, mediaStream;
let listening = false;
let currentNoteState = null;
let timelineCursor = null;

const MIN_REST = 0.09;
const MAX_REST_SECONDS = 6;
const HOLD_TIME = 0.15;

const SENSITIVITY_PARAMS = {
  alta:     { rmsThresh:0.008, clarityThresh:0.85, confirmFrames:2 },
  media:    { rmsThresh:0.014, clarityThresh:0.90, confirmFrames:3 },
  estricta: { rmsThresh:0.022, clarityThresh:0.94, confirmFrames:4 },
};

function autoCorrelate(buf, sampleRate){
  const SIZE = buf.length;
  let rms = 0;
  for(let i=0;i<SIZE;i++){ rms += buf[i]*buf[i]; }
  rms = Math.sqrt(rms/SIZE);
  
  const params = SENSITIVITY_PARAMS[document.getElementById('sensitivity').value];
  if(rms < params.rmsThresh) return {freq:-1, clarity:0, rms};

  let start=0, end=SIZE-1;
  const trimThresh = rms*0.2;
  while(start<SIZE && Math.abs(buf[start])<trimThresh) start++;
  while(end>start && Math.abs(buf[end])<trimThresh) end--;
  const trimmed = buf.slice(start, end+1);
  const N = trimmed.length;
  if(N < 512) return {freq:-1, clarity:0, rms};

  const maxLag = Math.min(Math.floor(sampleRate/55), N-1);
  const minLag = Math.floor(sampleRate/1800);
  const c = new Float32Array(maxLag+1);
  let globalBestLag = -1, globalBestCorr = 0;
  
  for(let lag=minLag; lag<=maxLag; lag++){
    let sum=0;
    for(let i=0;i<N-lag;i++){ sum += trimmed[i]*trimmed[i+lag]; }
    c[lag]=sum;
    if(sum>globalBestCorr){ globalBestCorr=sum; globalBestLag=lag; }
  }
  if(globalBestLag<=0) return {freq:-1, clarity:0, rms};

  let chosenLag = globalBestLag;
  for(let lag=minLag+1; lag<maxLag; lag++){
    if(c[lag] > c[lag-1] && c[lag] >= c[lag+1] && c[lag] > globalBestCorr*0.86){
      chosenLag = lag;
      break;
    }
  }

  let energy=0;
  for(let i=0;i<N-chosenLag;i++){ 
    energy += trimmed[i]*trimmed[i] + trimmed[i+chosenLag]*trimmed[i+chosenLag]; 
  }
  const clarity = energy>0 ? (2*c[chosenLag])/energy : 0;

  let lag = chosenLag;
  if(lag>minLag && lag<maxLag){
    const y1=c[lag-1], y2=c[lag], y3=c[lag+1];
    const denom = (y1 - 2*y2 + y3);
    if(denom !== 0){
      const shift = 0.5*(y1-y3)/denom;
      lag = lag + shift;
    }
  }
  
  const freq = sampleRate/lag;
  return {freq, clarity, rms};
}

function freqToMidi(freq){ 
  return 69 + 12*Math.log2(freq/440); 
}

function processAudioFrame(buf, sampleRate){
  const {freq, clarity, rms} = autoCorrelate(buf, sampleRate);
  const params = SENSITIVITY_PARAMS[document.getElementById('sensitivity').value];
  
  document.getElementById('statFreq').textContent = freq>0 ? freq.toFixed(1)+' Hz' : '— Hz';
  document.getElementById('statConf').textContent = freq>0 ? Math.round(clarity*100)+'%' : '—';

  if(freq<0 || clarity < params.clarityThresh){
    handleSilence();
    return;
  }
  
  const midi = freqToMidi(freq);
  const nearest = Math.round(midi);
  const cents = Math.round((midi-nearest)*100);
  updateTuningUI(nearest, cents, true);

  const autocorrectOn = document.getElementById('autocorrectToggle').checked;
  const now = performance.now()/1000;

  if(!currentNoteState){
    if(document.getElementById('restToggle').checked && timelineCursor !== null){
      const gap = now - timelineCursor;
      if(gap > MIN_REST && gap < MAX_REST_SECONDS){
        const bpm = +document.getElementById('bpm').value || 100;
        const beatLen = 60/bpm;
        const q = quantizeDuration(gap/beatLen);
        addRestToScore(q);
      }
    }
    currentNoteState = { 
      midi:nearest, 
      startTime:now, 
      lastSeen:now, 
      samples:[midi], 
      confirmedFrames:1 
    };
    return;
  }

  const sameNote = currentNoteState.midi === nearest;
  if(sameNote){
    currentNoteState.samples.push(midi);
    currentNoteState.lastSeen = now;
    currentNoteState.confirmedFrames++;
    
    if(!currentNoteState.announced && 
       (!autocorrectOn || currentNoteState.confirmedFrames >= params.confirmFrames)){
      announceNote(currentNoteState.midi);
      currentNoteState.announced = true;
    }
  } else {
    currentNoteState.pendingMidi = currentNoteState.pendingMidi===nearest 
      ? currentNoteState.pendingMidi 
      : nearest;
    currentNoteState.pendingCount = (currentNoteState.pendingMidi===nearest) 
      ? (currentNoteState.pendingCount||0)+1 
      : 1;
    
    const need = autocorrectOn ? params.confirmFrames : 1;
    if(currentNoteState.pendingCount >= need){
      finalizeNote(now);
      currentNoteState = { 
        midi:nearest, 
        startTime:now, 
        lastSeen:now, 
        samples:[midi], 
        confirmedFrames:1 
      };
    }
  }
}

function handleSilence(){
  updateTuningUI(null,0,false);
  if(currentNoteState){
    const now = performance.now()/1000;
    if(now - currentNoteState.lastSeen > 0.06){
      finalizeNote(now);
      currentNoteState = null;
    }
  }
}

function finalizeNote(endTime){
  if(!currentNoteState) return;
  const dur = endTime - currentNoteState.startTime;
  
  const MIN_NOTE = 0.045;
  if(dur < MIN_NOTE) return;
  
  const bpm = +document.getElementById('bpm').value || 100;
  const beatLen = 60/bpm;
  const beats = dur/beatLen;
  const q = quantizeDuration(beats);
  
  addNoteToScore(currentNoteState.midi, q);
  timelineCursor = endTime;
}

/* ================================================================
   3. INTERFAZ EN VIVO: nota grande, afinación, voz
   ================================================================ */
function updateTuningUI(midi, cents, active){
  const key = currentKey();
  const big = document.getElementById('noteBig');
  const sub = document.getElementById('noteSub');
  const fill = document.getElementById('tuningFill');
  const centsText = document.getElementById('centsText');
  const bellows = document.getElementById('bellows');
  bellows.classList.toggle('active', !!active);
  
  if(midi===null){
    big.textContent = '—'; 
    sub.textContent='esperando sonido…';
    fill.style.left='50%'; 
    centsText.textContent='0 cents';
    return;
  }
  
  const info = midiToInfo(midi, key.flats);
  big.textContent = info.name;
  sub.textContent = 'octava '+info.octave;
  const pct = 50 + Math.max(-50, Math.min(50, cents/50*50));
  fill.style.left = pct+'%';
  centsText.textContent = (cents>0?'+':'')+cents+' cents';
}

let lastAnnouncedMidi = null;
let speechQueueLen = 0;

function announceNote(midi){
  const key = currentKey();
  const info = midiToInfo(midi, key.flats);
  if(!document.getElementById('voiceToggle').checked) return;
  if(midi===lastAnnouncedMidi) return;
  lastAnnouncedMidi = midi;
  
  if('speechSynthesis' in window){
    if(speechQueueLen > 2){ speechSynthesis.cancel(); speechQueueLen=0; }
    const utter = new SpeechSynthesisUtterance(info.spoken);
    utter.lang = 'es-AR';
    utter.rate = 1.15;
    speechQueueLen++;
    utter.onend = ()=>{ speechQueueLen = Math.max(0,speechQueueLen-1); };
    utter.onerror = ()=>{ speechQueueLen = Math.max(0,speechQueueLen-1); };
    speechSynthesis.speak(utter);
  }
}

/* ================================================================
   4. MODELO DE PARTITURA + RENDER CON VEXFLOW 4.2.2
   ================================================================ */
let scoreNotes = [];

function addNoteToScore(midi, q){
  scoreNotes.push({ 
    type:'note', 
    midi, 
    code:q.code.replace('d',''), 
    dots:q.code.includes('d')?1:0, 
    label:q.label 
  });
  renderScore();
  updateStats();
}

function addRestToScore(q){
  scoreNotes.push({ 
    type:'rest', 
    code:q.code.replace('d',''), 
    dots:q.code.includes('d')?1:0, 
    label:q.label+' (silencio)' 
  });
  renderScore();
  updateStats();
}

function undoNote(){
  scoreNotes.pop();
  renderScore();
  updateStats();
}

function clearScore(){
  scoreNotes = [];
  renderScore();
  updateStats();
}

function updateStats(){
  const notes = scoreNotes.filter(n=>n.type==='note');
  const rests = scoreNotes.filter(n=>n.type==='rest');
  document.getElementById('statCount').textContent = notes.length;
  document.getElementById('statRests').textContent = rests.length;
  const last = scoreNotes[scoreNotes.length-1];
  document.getElementById('statDur').textContent = last ? last.label : '—';
}

function timeSigBeats(){
  const ts = document.getElementById('timeSig').value;
  const [num, den] = ts.split('/').map(Number);
  return { num, den, beatsPerMeasure: num*(4/den) };
}

function buildMeasures(){
  const { beatsPerMeasure } = timeSigBeats();
  const measures = [[]];
  let acc = 0;
  
  scoreNotes.forEach(n=>{
    let beats = beatsOfCode(n.code) * (n.dots ? 1.5 : 1);
    
    if(acc + beats > beatsPerMeasure + 0.001 && measures[measures.length-1].length>0){
      measures.push([]);
      acc = 0;
    }
    
    measures[measures.length-1].push(n);
    acc += beats;
    
    if(acc >= beatsPerMeasure - 0.001) { 
      measures.push([]); 
      acc = 0; 
    }
  });
  
  if(measures[measures.length-1].length===0) measures.pop();
  if(measures.length===0) measures.push([]);
  return measures;
}

function renderScore(){
  const container = document.getElementById('scoreSvg');
  container.innerHTML = '';
  
  if(typeof Vex === 'undefined' || !Vex.Flow){
    container.innerHTML = '<div style="padding:20px;color:#7a2230;font-family:monospace;font-size:13px;">'+
      '⚠ No se pudo cargar VexFlow. Revisá tu conexión a internet y recargá la página.</div>';
    return;
  }
  
  try{
    renderScoreInner(container);
  }catch(err){
    container.innerHTML = '<div style="padding:20px;color:#7a2230;font-family:monospace;font-size:13px;">'+
      '⚠ Error al dibujar: '+err.message+'</div>';
    console.error(err);
  }
}

function renderScoreInner(container){
  const { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Dot, Beam } = Vex.Flow;
  const key = currentKey();
  const ts = document.getElementById('timeSig').value;
  const { beatsPerMeasure } = timeSigBeats();
  const measures = buildMeasures();

  const measureWidth = 220;
  const containerWidth = Math.max(360, (container.parentElement.clientWidth || 900) - 20);
  const measuresPerRow = Math.max(1, Math.floor((containerWidth-40)/measureWidth));
  const rows = [];
  for(let i=0;i<measures.length;i+=measuresPerRow) rows.push(measures.slice(i,i+measuresPerRow));
  if(rows.length===0) rows.push([[]]);

  const rowHeight = 150;
  const title = (document.getElementById('scoreTitle').value||'').trim();
  const composer = (document.getElementById('scoreComposer').value||'').trim();
  const topOffset = (title||composer) ? 40 : 6;
  const svgWidth = Math.max(containerWidth+40, 40 + Math.min(measures.length, measuresPerRow)*measureWidth + 40);
  const svgHeight = topOffset + rows.length*rowHeight + 30;

  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(svgWidth, svgHeight);
  const ctx = renderer.getContext();
  ctx.setFont('Georgia', 10);

  if(title){
    ctx.save();
    ctx.setFont('Georgia', 20, 'bold');
    ctx.fillText(title, 20, 24);
    ctx.restore();
  }
  if(composer){
    ctx.save();
    ctx.setFont('Georgia', 12, 'italic');
    const approxWidth = composer.length*6.5;
    ctx.fillText(composer, Math.max(20, svgWidth-20-approxWidth), 24);
    ctx.restore();
  }

  let measureCounter = 0;
  rows.forEach((row, rowIdx)=>{
    let x = 20;
    const y = topOffset + rowIdx*rowHeight + 10;
    
    row.forEach((measure, mi)=>{
      measureCounter++;
      const isVeryFirst = (rowIdx===0 && mi===0);
      const stave = new Stave(x, y, measureWidth);
      
      if(isVeryFirst){
        stave.addClef('treble')
             .addKeySignature(key.vex)
             .addTimeSignature(ts);
      } else if(mi===0){
        stave.addClef('treble')
             .addKeySignature(key.vex);
      }
      
      stave.setContext(ctx).draw();

      ctx.save();
      ctx.setFont('JetBrains Mono', 9);
      ctx.fillText(String(measureCounter), x+2, y-4);
      ctx.restore();

      if(measure.length>0){
        const staveNotes = measure.map(n=>{
          if(n.type==='rest'){
            const sn = new StaveNote({ 
              clef:'treble', 
              keys:['b/4'], 
              duration:n.code+(n.dots?'d':'')+'r' 
            });
            if(n.dots) Dot.buildAndAttach([sn], {all:true});
            return sn;
          }
          
          const info = midiToInfo(n.midi, key.flats);
          const sn = new StaveNote({ 
            clef:'treble', 
            keys:[info.vexKey], 
            duration:n.code+(n.dots?'d':'') 
          });
          if(n.dots) Dot.buildAndAttach([sn], {all:true});
          return sn;
        });
        
        Accidental.applyAccidentals([staveNotes], key.vex);
        const voice = new Voice({ 
          num_beats: beatsPerMeasure, 
          beat_value: 4 
        }).setStrict(false);
        voice.addTickables(staveNotes);
        new Formatter().joinVoices([voice]).format([voice], measureWidth-40);
        voice.draw(ctx, stave);
        
        const beams = Beam.generateBeams(staveNotes);
        beams.forEach(b => b.setContext(ctx).draw());
      }
      
      x += measureWidth;
    });
  });
}

/* ================================================================
   5. REPRODUCCIÓN: Tone.js PolySynth con sonido de acordeón
   ================================================================ */
let synth = null, reverb = null, vibrato = null, isPlaying = false, scheduledEventIds = [];

async function ensureSynth(){
  if(synth) return;
  if(typeof Tone === 'undefined'){
    alert('No se pudo cargar Tone.js. Revisá tu conexión a internet y recargá la página.');
    throw new Error('Tone.js no disponible');
  }
  
  await Tone.start();
  
  reverb = new Tone.Reverb({ decay: 2.2, wet: 0.22 }).toDestination();
  vibrato = new Tone.Vibrato({ frequency: 5, depth: 0.08 }).connect(reverb);
  
  synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2.01,
    modulationIndex: 3,
    oscillator: { type:'sine' },
    envelope: { attack:0.008, decay:0.25, sustain:0.65, release:0.6 },
    modulation: { type:'triangle' },
    modulationEnvelope: { attack:0.02, decay:0.3, sustain:0.2, release:0.4 }
  }).connect(vibrato);
  
  synth.volume.value = -6;
}

async function playScore(){
  if(scoreNotes.length===0) return;
  try{
    await ensureSynth();
  }catch(err){
    return;
  }
  
  hardStopPlayback();
  isPlaying = true;
  document.getElementById('playBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  
  const bpm = +document.getElementById('bpm').value || 100;
  const beatLen = 60/bpm;
  let t = 0;
  
  scoreNotes.forEach(n=>{
    const beats = beatsOfCode(n.code) * (n.dots?1.5:1);
    const dur = beats*beatLen;
    
    if(n.type!=='rest'){
      const freq = Tone.Frequency(n.midi, 'midi').toFrequency();
      const noteTime = t;
      const id = Tone.Transport.schedule((time)=>{
        synth.triggerAttackRelease(freq, dur*0.92, time);
      }, noteTime);
      scheduledEventIds.push(id);
    }
    
    t += dur;
  });
  
  const endId = Tone.Transport.schedule(()=>{ stopScore(); }, t + 0.25);
  scheduledEventIds.push(endId);
  Tone.Transport.start();
}

function hardStopPlayback(){
  scheduledEventIds.forEach(id => Tone.Transport.clear(id));
  scheduledEventIds = [];
  Tone.Transport.stop();
  Tone.Transport.cancel();
  Tone.Transport.position = 0;
  if(synth) synth.releaseAll();
}

function stopScore(){
  isPlaying = false;
  hardStopPlayback();
  document.getElementById('playBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
}

/* ================================================================
   6. EXPORTACIÓN: PNG / PDF / MusicXML / MIDI / Imprimir
   ================================================================ */
function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; 
  a.download = filename;
  document.body.appendChild(a); 
  a.click(); 
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

function escapeXml(s){ 
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;'); 
}

function svgToCanvas(scale){
  return new Promise((resolve)=>{
    const svg = document.querySelector('#scoreSvg svg');
    if(!svg) return resolve(null);
    
    const serializer = new XMLSerializer();
    let svgStr = serializer.serializeToString(svg);
    if(!svgStr.includes('xmlns=')) 
      svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    
    const svgBlob = new Blob([svgStr], {type:'image/svg+xml;charset=utf-8'});
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    
    img.onload = ()=>{
      const w = svg.width.baseVal.value || svg.getBoundingClientRect().width;
      const h = svg.height.baseVal.value || svg.getBoundingClientRect().height;
      const canvas = document.createElement('canvas');
      canvas.width = w*scale; 
      canvas.height = h*scale;
      
      const cctx = canvas.getContext('2d');
      cctx.fillStyle = '#ffffff';
      cctx.fillRect(0,0,canvas.width, canvas.height);
      cctx.drawImage(img, 0,0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.src = url;
  });
}

async function exportPng(){
  const canvas = await svgToCanvas(3);
  if(!canvas) return;
  canvas.toBlob(blob=> downloadBlob(blob, 'partitura-bandoneon.png'));
}

async function exportPdf(){
  const canvas = await svgToCanvas(3);
  if(!canvas) return;
  
  const { jsPDF } = window.jspdf;
  const orientation = canvas.width > canvas.height ? 'l' : 'p';
  const pdf = new jsPDF(orientation, 'pt', [canvas.width/3+40, canvas.height/3+40]);
  const imgData = canvas.toDataURL('image/png');
  pdf.addImage(imgData, 'PNG', 20, 20, canvas.width/3, canvas.height/3);
  pdf.save('partitura-bandoneon.pdf');
}

function exportXml(){
  const key = currentKey();
  const ts = document.getElementById('timeSig').value;
  const [num, den] = ts.split('/').map(Number);
  const divisions = 96;
  const fifths = KEY_FIFTHS[key.vex] ?? 0;
  const title = (document.getElementById('scoreTitle').value||'Transcripción de bandoneón').trim();
  const composer = (document.getElementById('scoreComposer').value||'').trim();
  const measures = buildMeasures();

  const measuresXml = measures.map((measure, idx)=>{
    const notesXml = measure.map(n=>{
      const beats = beatsOfCode(n.code) * (n.dots?1.5:1);
      const duration = Math.round(beats*divisions);
      
      if(n.type==='rest'){
        return `
      <note>
        <rest/>
        <duration>${duration}</duration>
        <type>${typeOfXml(n.code)}</type>
        ${n.dots? '<dot/>':''}
      </note>`;
      }
      
      const info = midiToInfo(n.midi, key.flats);
      const letter = info.vexKey[0].toUpperCase();
      let alter = 0;
      if(info.vexKey.includes('#')) alter = 1;
      if(info.vexKey.match(/[a-g]b/)) alter = -1;
      
      return `
      <note>
        <pitch>
          <step>${letter}</step>
          ${alter!==0? `<alter>${alter}</alter>`:''}
          <octave>${info.octave}</octave>
        </pitch>
        <duration>${duration}</duration>
        <type>${typeOfXml(n.code)}</type>
        ${n.dots? '<dot/>':''}
        ${alter!==0? `<accidental>${alter===1?'sharp':'flat'}</accidental>`:''}
      </note>`;
    }).join('');

    const attributesXml = idx===0 ? `
      <attributes>
        <divisions>${divisions}</divisions>
        <key><fifths>${fifths}</fifths></key>
        <time><beats>${num}</beats><beat-type>${den}</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>` : '';

    return `
    <measure number="${idx+1}">${attributesXml}${notesXml}
    </measure>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${escapeXml(title)}</work-title></work>
  ${composer? `<identification><creator type="composer">${escapeXml(composer)}</creator></identification>` : ''}
  <part-list>
    <score-part id="P1"><part-name>Bandoneón</part-name></score-part>
  </part-list>
  <part id="P1">${measuresXml}
  </part>
</score-partwise>`;
  
  downloadBlob(
    new Blob([xml], {type:'application/vnd.recordare.musicxml+xml'}), 
    'partitura-bandoneon.musicxml'
  );
}

function writeVarLen(value){
  const bytes = [];
  let buffer = value & 0x7f;
  while((value >>= 7) > 0){
    buffer <<= 8; 
    buffer |= 0x80; 
    buffer += (value & 0x7f);
  }
  while(true){
    bytes.push(buffer & 0xff);
    if(buffer & 0x80) buffer >>= 8; 
    else break;
  }
  return bytes;
}

function exportMidi(){
  const bpm = +document.getElementById('bpm').value || 100;
  const ticksPerBeat = 96;
  const usPerBeat = Math.round(60000000/bpm);

  let track = [];
  function pushEvent(deltaTicks, bytes){ 
    track.push({delta:deltaTicks, bytes}); 
  }
  
  pushEvent(0, [0xFF,0x51,0x03,(usPerBeat>>16)&0xff,(usPerBeat>>8)&0xff,usPerBeat&0xff]);

  let pendingRestTicks = 0;
  scoreNotes.forEach(n=>{
    const beats = beatsOfCode(n.code) * (n.dots?1.5:1);
    const ticks = Math.round(beats*ticksPerBeat);
    
    if(n.type==='rest'){
      pendingRestTicks += ticks;
      return;
    }
    
    pushEvent(pendingRestTicks, [0x90, n.midi & 0x7f, 0x64]);
    pendingRestTicks = 0;
    pushEvent(ticks, [0x80, n.midi & 0x7f, 0x40]);
  });
  
  pushEvent(pendingRestTicks, [0xFF,0x2F,0x00]);

  let trackBytes = [];
  track.forEach(ev=>{
    trackBytes.push(...writeVarLen(ev.delta));
    trackBytes.push(...ev.bytes);
  });

  const header = [
    0x4D,0x54,0x68,0x64, 0,0,0,6,
    0,0,
    0,1,
    (ticksPerBeat>>8)&0xff, ticksPerBeat&0xff
  ];

  const track_header = [
    0x4D,0x54,0x72,0x6B,
    (trackBytes.length>>24)&0xff, (trackBytes.length>>16)&0xff,
    (trackBytes.length>>8)&0xff, trackBytes.length&0xff
  ];

  const midi = new Uint8Array([...header, ...track_header, ...trackBytes]);
  downloadBlob(new Blob([midi], {type:'audio/midi'}), 'partitura-bandoneon.mid');
}

/* ================================================================
   7. IA GRATUITA PARA TEORÍA MUSICAL (Google Gemini API)
   ================================================================ */
const GEMINI_API_KEY = 'AIzaSyC-EXAMPLE-KEY-REPLACE-ME';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

async function explainNoteWithAI(midi){
  const key = currentKey();
  const info = getMusicalInfo(midi, key);
  const explainDiv = document.getElementById('aiExplain');
  
  explainDiv.innerHTML = '<b>⏳ Consultando Gemini...</b>';
  explainDiv.style.display = 'block';
  
  const prompt = `Eres un profesor de teoría musical. Explica brevemente (2-3 frases) esta nota musical:
- Nota: ${info.spoken} (${info.name})
- Tonalidad: ${info.keyName}
- Función armónica: ${info.degreeLabel}
${info.hasAccidental ? '- Tiene alteración (bemol/sostenido)' : ''}
Responde en español, corto y conciso.`;

  try {
    if(!GEMINI_API_KEY.includes('AIzaSy') || GEMINI_API_KEY.includes('EXAMPLE')){
      explainDiv.innerHTML = '<b>⚙️ Consejo:</b> Para usar IA, obtén clave gratis en <a href="https://ai.google.dev/" target="_blank">ai.google.dev</a> y reemplazala en script.js línea ~550.';
      return;
    }

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    if(!response.ok){
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No se pudo generar explicación.';
    explainDiv.innerHTML = '<b>🎓 Teoría:</b> ' + text;
  } catch(err) {
    console.error('Error Gemini:', err);
    explainDiv.innerHTML = `<b>ℹ️ Offline:</b> ${info.spoken} es la ${info.degreeLabel} de ${info.keyName}. Conecta internet y configura tu API key para más detalles.`;
  }
}

/* ================================================================
   8. EVENT LISTENERS: micrófono, botones, PWA
   ================================================================ */

document.getElementById('micBtn').addEventListener('click', async ()=>{
  if(listening){
    listening = false;
    if(scriptNode) scriptNode.disconnect();
    if(analyser) analyser.disconnect();
    if(micSource) micSource.disconnect();
    if(mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    document.getElementById('micBtn').textContent = '🎙️ Empezar a escuchar';
    document.getElementById('micBtn').classList.remove('recording');
    document.getElementById('statusText').textContent = 'Micrófono apagado';
    document.getElementById('statusDot').classList.remove('on');
    return;
  }

  try{
    if(!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    mediaStream = await navigator.mediaDevices.getUserMedia({audio:true});
    micSource = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.85;
    
    micSource.connect(analyser);
    
    scriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
    analyser.connect(scriptNode);
    scriptNode.connect(audioCtx.destination);
    
    listening = true;
    document.getElementById('micBtn').textContent = '⏹ Detener escucha';
    document.getElementById('micBtn').classList.add('recording');
    document.getElementById('statusText').textContent = 'Micrófono encendido ✓';
    document.getElementById('statusDot').classList.add('on');
    
    scriptNode.onaudioprocess = (event)=>{
      if(!listening) return;
      const buf = event.inputBuffer.getChannelData(0);
      processAudioFrame(buf, audioCtx.sampleRate);
    };
  } catch(err){
    alert('Error al acceder al micrófono: '+err.message);
    console.error(err);
  }
});

document.getElementById('undoBtn').addEventListener('click', undoNote);
document.getElementById('clearBtn').addEventListener('click', clearScore);
document.getElementById('playBtn').addEventListener('click', playScore);
document.getElementById('stopBtn').addEventListener('click', stopScore);

document.getElementById('exportPng').addEventListener('click', exportPng);
document.getElementById('exportPdf').addEventListener('click', exportPdf);
document.getElementById('exportXml').addEventListener('click', exportXml);
document.getElementById('exportMidi').addEventListener('click', exportMidi);
document.getElementById('printBtn').addEventListener('click', ()=>{ window.print(); });

document.getElementById('noteBig').addEventListener('click', ()=>{
  if(currentNoteState && currentNoteState.midi){
    explainNoteWithAI(currentNoteState.midi);
  }
});

let deferredPrompt = null;
const installBtn = document.getElementById('installBtn');

window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'block';
});

installBtn.addEventListener('click', async ()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`Usuario: ${outcome}`);
  deferredPrompt = null;
  installBtn.style.display = 'none';
});

document.getElementById('micPermBtn').addEventListener('click', async ()=>{
  try{
    const perm = await navigator.permissions.query({name:'microphone'});
    if(perm.state === 'granted'){
      alert('✓ Permiso de micrófono activado.');
    } else if(perm.state === 'prompt'){
      alert('Se te pedirá permiso cuando hagas click en "Empezar a escuchar".');
    } else {
      alert('❌ Permiso denegado. Abrí los ajustes de tu navegador.');
    }
  }catch(err){
    alert('No puedo verificar permisos en este navegador.');
  }
});

document.getElementById('siteSettingsBtn').addEventListener('click', ()=>{
  alert('Chrome: click derecho → Ajustes del sitio → Micrófono → Permitir\nFirefox: Preferences → Privacy → Permissions → Microphone\nSafari: Settings → Websites → Microphone');
});

let tapTempoTimes = [];
document.getElementById('tapTempo').addEventListener('click', ()=>{
  const now = Date.now();
  tapTempoTimes.push(now);
  if(tapTempoTimes.length > 8) tapTempoTimes.shift();
  
  if(tapTempoTimes.length >= 2){
    const intervals = [];
    for(let i=1; i<tapTempoTimes.length; i++){
      intervals.push(tapTempoTimes[i] - tapTempoTimes[i-1]);
    }
    const avgInterval = intervals.reduce((a,b)=>a+b)/intervals.length;
    const newBpm = Math.round(60000/avgInterval);
    document.getElementById('bpm').value = newBpm;
  }
});

document.getElementById('saveAppBtn').addEventListener('click', ()=>{
  alert('La app está lista para guardar. Usa el menú de tu navegador (Chrome: menu → Guardar y descargar → Instalar app).');
});

document.getElementById('standaloneBtn').addEventListener('click', ()=>{
  if(window.navigator.standalone === true){
    alert('Ya estás en modo standalone (instalado).');
  } else {
    alert('Haz clic en el menú de tu navegador y selecciona "Instalar app".');
  }
});

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').then(reg=>{
    console.log('Service Worker registrado ✓', reg);
  }).catch(err=>{
    console.log('Service Worker error:', err);
  });
}

renderScore();
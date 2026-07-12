let audioContext;
let analyser;
let notasDetectadas = [];

function iniciarMicrofono() {
  audioContext = new AudioContext();
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    source.connect(analyser);
    detectarNota();
  });
}

function detectarNota() {
  // Aquí iría tu código de detección de frecuencia
  console.log("Detectando...");
}

// DETECCIÓN RÁPIDA: 30ms = no se pierde notas
setInterval(detectarNota, 30);

function dibujarPartitura() {
  if(notasDetectadas.length === 0){
    document.getElementById('partitura').innerHTML = "Toca algo para ver la partitura";
    return;
  }
  // Aquí va el código de VexFlow/OSMD
}

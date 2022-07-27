import * as Comlink from 'comlink';


let form = document.querySelector('form');
let pre = document.querySelector('pre');
let outputEl = document.getElementById('output');


form.addEventListener('submit', (event) => {
  event.preventDefault();

  let data = new FormData(event.currentTarget);

  let layerMerge = data.get('layerMerge');
  let layerRenderOrder = data.get('layerRenderOrder');

  let options = {
    colorMode: true,
    file: data.get('file'),
    layerMerge: (layerMerge ? layerMerge.split(';').map((s) => s.split(',').map((k) => parseInt(k))) : null),
    layerRenderOrder: (layerRenderOrder ? layerRenderOrder.split(',').map((s) => parseInt(s)) : null),
    minGroupSize: parseFloat(data.get('minGroupSize')),
    maxGroupSize: parseFloat(data.get('maxGroupSize')),
    outputWidth: parseInt(data.get('outputWidth')),
    testMode: (data.get('vectorGraphics') !== 'on'),
    tolerance: parseFloat(data.get('tolerance'))
  };

  process(options);
});


let running = false;
let worker = null;

async function process(options) {
  pre.innerText = '';

  let log = (line) => {
    pre.innerText += (line + '\n');
  };

  if (options.file.size < 1) {
    log('No file selected');
    return;
  }

  outputEl.innerHTML = '';

  if (running) {
    worker.terminate();
    worker = null;
  }

  if (!worker) {
    worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
  }

  let offscreen = null;

  if (options.testMode) {
    let canvas = document.createElement('canvas');
    outputEl.appendChild(canvas);

    offscreen = canvas.transferControlToOffscreen();
  }

  let { compute } = Comlink.wrap(worker)

  running = true;
  let result = await compute(Comlink.transfer({ ...options, canvas: offscreen }, offscreen ? [offscreen] : []), Comlink.proxy(log));
  running = false;

  if (!options.testMode) {
    outputEl.innerHTML = result.svg;

    let svgEl = outputEl.querySelector('svg');
    let layerIndicator = document.createElement('div');
    let groupIndicator = document.createElement('div');

    let downloadEl = document.createElement('button');
    downloadEl.innerText = 'Download';

    outputEl.appendChild(layerIndicator);
    outputEl.appendChild(groupIndicator);
    outputEl.appendChild(downloadEl);

    for (let el of outputEl.querySelectorAll('g')) {
      el.addEventListener('mouseenter', () => {
        let layerIndex = el.dataset.layerIndex;
        let groupIndex = el.dataset.groupIndex;

        layerIndicator.innerHTML = `<b>Layer:</b> ${layerIndex}`;
        groupIndicator.innerHTML = `<b>Group:</b> ${groupIndex}`;

        el.classList.add('_active');
        svgEl.classList.add('_selected');
      });

      el.addEventListener('mouseleave', () => {
        el.classList.remove('_active');
        svgEl.classList.remove('_selected');
      });
    }

    downloadEl.addEventListener('click', () => {
      let a = document.createElement('a');

      a.style.display = 'none';
      a.href = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
      a.download = 'diagram.svg';

      document.body.appendChild(a);
      a.click();

      URL.revokeObjectURL(url);
    });
  }
}

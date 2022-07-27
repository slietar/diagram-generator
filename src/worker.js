import * as Comlink from 'comlink';
import { Helper } from 'dxf';
import { COLOR_TRANSPARENT, Potrace } from 'potrace';

import * as collision from './collision';


async function compute(options, log) {
  await log('Starting');

  // -- Loading ---------------------------------------------------------------

  let text = await options.file.text();
  let helper = new Helper(text);
  let output = helper.toPolylines();

  let colors = output.polylines.map((line) => {
    let [r, g, b] = line.rgb;
    return r * 0x10000 + g * 0x100 + b;
  });

  let uniqueColors = colors.filter((color, index) => colors.indexOf(color) === index);

  let layers = uniqueColors.map((color) =>
    output.polylines
      .filter((_polyline, index) => colors[index] === color)
      .map((polyline) => polyline.vertices)
  );

  await log('Loaded input');
  await log(`Found ${layers.length} layers and ${output.polylines.length} polylines`);


  // -- Processing ------------------------------------------------------------

  let layerGroups = [];

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    await log(`Processing layer ${layerIndex}`);

    // if (layerIndex !== 2) continue;
    let layer = layers[layerIndex];
    let bboxes = layer.map(collision.findBbox);

    let groups = [];
    let explored = new Set();

    let explore = (polylineIndex) => {
      let group = [];
      let queue = [polylineIndex];

      explored.add(polylineIndex);

      while (queue.length > 0) {
        let polylineIndex = queue.shift();
        let polyline = layer[polylineIndex];

        group.push(polyline);

        for (let otherIndex = 0; otherIndex < layer.length; otherIndex++) {
          if (!explored.has(otherIndex) && collision.aabb(bboxes[polylineIndex], bboxes[otherIndex], options.tolerance)) {
            explored.add(otherIndex);
            queue.push(otherIndex);
          }
        }
      }

      return group;
    };

    for (let polylineIndex = 0; polylineIndex < layer.length; polylineIndex++) {
      if (!explored.has(polylineIndex)) {
        let group = explore(polylineIndex);

        if (options.minGroupSize > 0 || options.maxGroupSize > 0) {
          let { width, height } = collision.findBbox(group.flat());
          let size = Math.max(width, height);

          if ((options.minGroupSize > 0 && size < options.minGroupSize)
            || (options.maxGroupSize > 0 && size > options.maxGroupSize)) {
            continue;
          }

          // console.error(size);
        }

        await log(`  - Found group ${groups.length} with ${group.length} polygons`);
        groups.push(group);
      }
    }

    layerGroups.push(groups);
    await log(`Done processing layer ${layerIndex}`);
  }


  // -- Tracing -------------------------------------------------------------

  let width = output.bbox.max.x - output.bbox.min.x;
  let height = output.bbox.max.y - output.bbox.min.y;

  let outputWidth = options.outputWidth;
  let outputHeight = outputWidth / width * height;

  let globalCtx;
  let svg;

  if (options.testMode) {
    options.canvas.width = outputWidth;
    options.canvas.height = outputHeight;
    globalCtx = options.canvas.getContext('2d');
  } else {
    svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${outputWidth} ${outputHeight}">`;
  }

  let renderOrder = options.layerRenderOrder
    ?? layerGroups
      .map((_groups, index) => index)
      .sort((a, b) => layerGroups[a].length - layerGroups[b].length);

  for (let index = 0; index < renderOrder.length; index++) {
    let layerIndex = renderOrder[index];
    let groups = layerGroups[layerIndex];

    log(`Tracing layer ${layerIndex}`);

    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      let group = groups[groupIndex];
      let color = `hsl(${groupIndex / groups.length * 360}, 100%, 50%)`;

      let canvas = new OffscreenCanvas(outputWidth, outputHeight);
      let ctx = canvas.getContext('2d');

      ctx.scale(1, -1);
      ctx.translate(0, -canvas.height);

      for (let polyline of group) {
        ctx.beginPath();

        for (let vertexIndex = 0; vertexIndex < polyline.length; vertexIndex++) {
          let [x, y] = polyline[vertexIndex];

          let xp = Math.round((x - output.bbox.min.x) * outputWidth / width);
          let yp = Math.round((y - output.bbox.min.y) * outputWidth / width);

          if (vertexIndex === 0) {
            ctx.moveTo(xp, yp);
          } else {
            ctx.lineTo(xp, yp);
          }
        }

        if (options.testMode && options.colorMode) {
          ctx.fillStyle = color;
        }

        ctx.fill();
      }

      if (options.testMode) {
        globalCtx.drawImage(canvas, 0, 0, outputWidth, outputHeight);
        log(`  - Done drawing group ${groupIndex}`);
      } else {
        let trace = new Potrace({
          color: options.colorMode ? color : COLOR_TRANSPARENT
        });

        let blob = await canvas.convertToBlob();
        let buffer = await blob.arrayBuffer();

        await new Promise((resolve, reject) => {
          trace.loadImage(buffer, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        svg += `<g data-layer-index="${layerIndex}" data-group-index="${groupIndex}">${trace.getPathTag()}</g>`;

        log(`  - Done tracing group ${groupIndex}`);
      }
    }
  }

  if (!options.testMode) {
    svg += '</svg>';
  }

  log('Done');


  return options.testMode
    ? {}
    : { svg };
}


Comlink.expose({ compute });

const { createCanvas } = require('canvas');
const dxf = require('dxf');
const fs = require('fs/promises');
const minimist = require('minimist');
const path = require('path');
const potrace = require('potrace');

const collision = require('./src/collision');


main().catch((err) => {
  console.error(err);
  process.exit(1);
});


async function main() {
  let args = minimist(process.argv.slice(2));

  if (args.h || args.help) {
    console.log(`Usage: schematic [options]

Options:
    -h, --help          Display this message.
    --input <file>      Input file path. Defaults to standard input.
    --output <file>     Output file path. Defaults to standard output.
    --minsize <value>   Minimum group size (maximum of width and height). Defaults to 1100.
    --maxsize <value>   Maximum group size (maximum of width and height). Defaults to 0 (disabled).
    --sort              Sort groups with the largest groups on top (rendered last). Defaults to true, use --no-sort to disable.
    --tolerance <value> Tolerance when grouping polylines. Defaults to 5.
    --width <value>     Output image width. Significantly affects performance. Defaults to 6400.
    --color             Enable colors on the output file.
    --test              Enable test mode. Create a PNG file instead of SVG and enable --color if not set.
    --silent            Disable progress messages.`);

    return;
  }


  let inputData;

  if (args.input) {
    let filepath = path.resolve(process.cwd(), args.input);
    inputData = await fs.readFile(filepath);
  } else {
    inputData = await getStdin();
  }


  let log = (message) => {
    if (!args.silent) {
      console.error(message);
    }
  };


  let helper = new dxf.Helper(inputData.toString());
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

  log('Loaded input');
  log(`Found ${layers.length} layers and ${output.polylines.length} polylines`);


  let tolerance = args.tolerance ?? 5;
  let outputWidth = args.width ?? 6400;
  let minGroupSize = args.minsize ?? 1100;
  let maxGroupSize = args.maxsize ?? 0;
  let sort = args.sort ?? true;
  let testMode = args.test;
  let colorMode = args.color || (testMode && args.color === void 0);


  let width = output.bbox.max.x - output.bbox.min.x;
  let height = output.bbox.max.y - output.bbox.min.y;
  let outputHeight = outputWidth / width * height;


  let globalCanvas, globalCtx;
  let svg;

  if (testMode) {
    globalCanvas = createCanvas(outputWidth, outputHeight);
    globalCtx = globalCanvas.getContext('2d');
  } else {
    svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${outputWidth} ${outputHeight}">`;
  }


  // layers = [layers[0], [...layers[1], ...layers[2]]];

  let layerGroups = [];

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    // if (layerIndex !== 2) continue;

    let layer = layers[layerIndex];
    let bboxes = layer.map(collision.findBbox);

    let groups = [];
    let explored = new Set();

    let explore = (polylineIndex) => {
      let polyline = layer[polylineIndex];

      explored.add(polylineIndex);

      let group = [polyline];

      for (let otherIndex = 0; otherIndex < layer.length; otherIndex++) {
        if (explored.has(otherIndex)) {
          continue;
        }

        if (collision.aabb(bboxes[polylineIndex], bboxes[otherIndex], tolerance)) {
          group.push(...explore(otherIndex));
        }
      }

      return group;
    };

    for (let polylineIndex = 0; polylineIndex < layer.length; polylineIndex++) {
      if (!explored.has(polylineIndex)) {
        let group = explore(polylineIndex);

        if (minGroupSize > 0 || maxGroupSize > 0) {
          let { width, height } = collision.findBbox(group.flat());
          let size = Math.max(width, height);

          if ((minGroupSize > 0 && size < minGroupSize)
            || (maxGroupSize > 0 && size > maxGroupSize)) {
            continue;
          }

          // console.error(size);
        }

        groups.push(group);
      }
    }

    layerGroups.push(groups);
    log(`Done processing layer ${layerIndex}`);
  }


  let renderOrder = layerGroups.map((_groups, index) => index);

  if (sort) {
    renderOrder = renderOrder.sort((a, b) => layerGroups[a].length - layerGroups[b].length);
  }

  for (let index = 0; index < layerGroups.length; index++) {
    let layerIndex = renderOrder[index];
    let groups = layerGroups[layerIndex];

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      let group = groups[groupIndex];
      let color = `hsl(${groupIndex / groups.length * 360}, 100%, 50%)`;

      let canvas = createCanvas(outputWidth, outputHeight);
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

        if (testMode && colorMode) {
          ctx.fillStyle = color;
        }

        ctx.fill();
      }

      if (testMode) {
        globalCtx.drawImage(canvas, 0, 0, outputWidth, outputHeight);
        log(`Done drawing group ${groupIndex} of layer ${layerIndex}`);
      } else {
        let trace = new potrace.Potrace({
          color: colorMode ? color : potrace.COLOR_TRANSPARENT
        });

        await new Promise((resolve, reject) => {
          trace.loadImage(canvas.toBuffer(), (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        svg += `<g data-layer-index="${layerGroups.length - index - 1}" data-group-index="${groupIndex}">${trace.getPathTag()}</g>`;

        log(`Done tracing group ${groupIndex} of layer ${layerIndex}`);
      }
    }
  }


  let outputData;

  if (testMode) {
    outputData = globalCanvas.toBuffer();
  } else {
    svg += '</svg>';
    outputData = Buffer.from(svg);
  }


  if (args.output) {
    let filepath = path.resolve(process.cwd(), args.output);
    await fs.writeFile(filepath, outputData);
  } else {
    process.stdout.write(outputData);
  }

  log('Done writing output');
}


async function getStdin() {
  let chunks = [];

  process.stdin.on('data', (chunk) => {
    chunks.push(chunk);
  });

  await new Promise((resolve) => {
    process.stdin.on('end', () => {
      resolve();
    });
  });

  return Buffer.concat(chunks);
}

function collisionAabb(body1, body2, eps = 5) {
  return !((body2.x > body1.x + body1.width + eps)
  || (body2.x + body2.width < body1.x - eps)
  || (body2.y > body1.y + body1.height + eps)
  || (body2.y + body2.height < body1.y - eps));
}

function collisionPolygon(body1, body2) {
  for (let body of [body1, body2]) {
    for (let index = 0; index < body.length; index++) {
      let point1 = body[index];
      let point2 = body[(index + 1) % body.length];

      let axis = normal(point1, point2);

      let [body1Min, body1Max] = sat(axis, body1);
      let [body2Min, body2Max] = sat(axis, body2);

      if (!overlaps(body1Min, body1Max, body2Min, body2Max)) {
        return false;
      }
    }
  }

  return true;
}

function overlaps(min1, max1, min2, max2) {
  return isBetweenOrdered(min2, min1, max1) || isBetweenOrdered(min1, min2, max2);
}

function isBetweenOrdered(val, lowerBound, upperBound) {
  // return lowerBound <= val && val <= upperBound;
  return lowerBound - val <= 100 && val - upperBound <= 100;
}

function sat(axis, body) {
  let min = Infinity;
  let max = -Infinity;

  for (let point of body) {
    let pointDot = dot(axis, point);

    if (pointDot < min) min = pointDot;
    if (pointDot > max) max = pointDot;
  }

  return [min, max];
}


function findBbox(vertices) {
  let minX = Infinity;
  let minY = Infinity;

  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let [x, y] of vertices) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;

    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}


function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function normal(point1, point2) {
  return {
    x: point1.y - point2.y,
    y: point2.x - point1.x
  };
}


Object.assign(exports, {
  aabb: collisionAabb,
  polygon: collisionPolygon,

  findBbox
});

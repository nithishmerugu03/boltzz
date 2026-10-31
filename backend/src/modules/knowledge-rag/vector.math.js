'use strict';

const { validVector } = require('./embedding.service');

function cosineSimilarity(left, right) {
  if (!validVector(left) || !validVector(right)) throw new TypeError('Expected finite, nonzero 384-dimensional vectors');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm) / Math.sqrt(rightNorm)));
}

module.exports = { cosineSimilarity };

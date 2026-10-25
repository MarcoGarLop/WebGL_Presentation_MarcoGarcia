// ---------- WebGL helpers ----------
function createGL(canvas) {
  const gl = canvas.getContext("webgl");
  if (!gl) {
    const message = document.createElement("p");
    message.className = "fallback";
    message.textContent = "WebGL is not supported in this browser.";
    canvas.replaceWith(message);
  }
  return gl;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]].forEach(function (item) {
    const shader = gl.createShader(item[0]);
    gl.shaderSource(shader, item[1]);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  });
  gl.linkProgram(program);
  gl.useProgram(program);
  return program;
}

function createBuffer(gl, target, data) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return buffer;
}

// ---------- Hero background (grid of animated points) ----------
const heroVertex = `
  attribute vec2 aGrid;
  uniform vec2 uMouse;
  uniform float uTime;
  uniform float uAspect;
  varying vec3 vColor;
  void main() {
    vec2 p = aGrid;
    // Gentle wave movement
    p.y += 0.03 * sin(aGrid.x * 5.0 + uTime);
    p.x += 0.015 * cos(aGrid.y * 4.0 + uTime * 0.8);
    // Ripples push points away from the mouse
    vec2 d = p - uMouse;
    float dist = length(d * vec2(uAspect, 1.0));
    float near = smoothstep(0.5, 0.0, dist);
    float ripple = sin(dist * 18.0 - uTime * 3.0) * near;
    p += normalize(d + 0.0001) * (near * 0.1 + ripple * 0.03);
    vColor = mix(vec3(0.25, 0.4, 0.8), vec3(0.6, 0.45, 0.95), aGrid.x * 0.5 + 0.5) * (0.6 + 0.3 * near + 0.2 * ripple);
    gl_PointSize = 2.5 + 4.0 * near;
    gl_Position = vec4(p, 0.0, 1.0);
  }`;

const heroFragment = `
  precision mediump float;
  varying vec3 vColor;
  void main() {
    // Draw round points
    if (length(gl_PointCoord - 0.5) > 0.5) discard;
    gl_FragColor = vec4(vColor, 1.0);
  }`;

const heroCanvas = document.getElementById("hero-canvas");
const heroGL = createGL(heroCanvas);
const COLS = 70;
const ROWS = 40;
let mouse = [0.5, 0.5];
let smoothMouse = [0.5, 0.5];
let heroUniforms;

if (heroGL) {
  const program = createProgram(heroGL, heroVertex, heroFragment);
  const grid = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      grid.push((x / (COLS - 1)) * 2 - 1, (y / (ROWS - 1)) * 2 - 1);
    }
  }
  createBuffer(heroGL, heroGL.ARRAY_BUFFER, new Float32Array(grid));
  const position = heroGL.getAttribLocation(program, "aGrid");
  heroGL.enableVertexAttribArray(position);
  heroGL.vertexAttribPointer(position, 2, heroGL.FLOAT, false, 0, 0);
  heroUniforms = {
    mouse: heroGL.getUniformLocation(program, "uMouse"),
    time: heroGL.getUniformLocation(program, "uTime"),
    aspect: heroGL.getUniformLocation(program, "uAspect")
  };
  heroGL.clearColor(0.055, 0.078, 0.125, 1);
}

function resizeHero() {
  heroCanvas.width = heroCanvas.clientWidth;
  heroCanvas.height = heroCanvas.clientHeight;
}

function drawHero(seconds) {
  // Follow the mouse smoothly
  smoothMouse[0] += (mouse[0] - smoothMouse[0]) * 0.1;
  smoothMouse[1] += (mouse[1] - smoothMouse[1]) * 0.1;
  heroGL.viewport(0, 0, heroCanvas.width, heroCanvas.height);
  heroGL.clear(heroGL.COLOR_BUFFER_BIT);
  heroGL.uniform2f(heroUniforms.mouse, smoothMouse[0] * 2 - 1, smoothMouse[1] * 2 - 1);
  heroGL.uniform1f(heroUniforms.time, seconds);
  heroGL.uniform1f(heroUniforms.aspect, heroCanvas.width / heroCanvas.height);
  heroGL.drawArrays(heroGL.POINTS, 0, COLS * ROWS);
}

window.addEventListener("pointermove", function (event) {
  mouse = [event.clientX / window.innerWidth, 1 - event.clientY / window.innerHeight];
});
window.addEventListener("resize", function () {
  if (heroGL) resizeHero();
});

// ---------- 3D cube ----------
const cubeVertex = `
  attribute vec3 aPos;
  uniform vec2 uRot;
  varying vec3 vPos;
  void main() {
    float cx = cos(uRot.x), sx = sin(uRot.x);
    float cy = cos(uRot.y), sy = sin(uRot.y);
    // Rotate around the Y axis, then around the X axis
    vec3 p = vec3(cy * aPos.x + sy * aPos.z, aPos.y, -sy * aPos.x + cy * aPos.z);
    p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
    vPos = aPos;
    // The last value makes far points look smaller
    gl_Position = vec4(p.x * 1.5, p.y * 2.2, p.z, p.z + 4.0);
  }`;

const cubeFragment = `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uEdge;
  varying vec3 vPos;
  void main() {
    // Each pair of faces gets its own brightness
    vec3 a = abs(vPos);
    float shade = 0.7;
    if (a.x > a.y && a.x > a.z) shade = 0.5;
    else if (a.y > a.z) shade = 1.0;
    // uEdge = 1 draws white lines
    gl_FragColor = vec4(mix(uColor * shade, vec3(1.0), uEdge), 1.0);
  }`;

const cubeCanvas = document.getElementById("cube-canvas");
const cubeGL = createGL(cubeCanvas);
const rotation = [0.5, 0.7];
let velocity = [0, 0];
let color = [0.36, 0.55, 0.94];
let dragging = false;
let cubeUniforms, faceBuffer, edgeBuffer;

const speedInput = document.getElementById("speed");
const wireInput = document.getElementById("wire");

if (cubeGL) {
  const gl = cubeGL;
  const program = createProgram(gl, cubeVertex, cubeFragment);
  // 8 corners of the cube
  createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, -1,  1, -1, -1,  -1, 1, -1,  1, 1, -1,
    -1, -1, 1,   1, -1, 1,   -1, 1, 1,   1, 1, 1
  ]));
  const position = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);

  // 12 triangles for the faces and 12 lines for the edges
  faceBuffer = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([
    0, 1, 2, 1, 3, 2,  4, 5, 6, 5, 7, 6,  0, 2, 4, 2, 6, 4,
    1, 3, 5, 3, 7, 5,  0, 1, 4, 1, 5, 4,  2, 3, 6, 3, 7, 6
  ]));
  edgeBuffer = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([
    0, 1, 2, 3, 4, 5, 6, 7,  0, 2, 1, 3, 4, 6, 5, 7,  0, 4, 1, 5, 2, 6, 3, 7
  ]));

  gl.enable(gl.DEPTH_TEST);
  // Push faces back a little so the edges draw on top
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1, 1);
  cubeUniforms = {
    rot: gl.getUniformLocation(program, "uRot"),
    color: gl.getUniformLocation(program, "uColor"),
    edge: gl.getUniformLocation(program, "uEdge")
  };
}

function drawCube() {
  const gl = cubeGL;
  gl.viewport(0, 0, cubeCanvas.width, cubeCanvas.height);
  gl.clearColor(0.04, 0.06, 0.09, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniform2f(cubeUniforms.rot, rotation[0], rotation[1]);
  gl.uniform3f(cubeUniforms.color, color[0], color[1], color[2]);

  // Faces (hidden in wireframe mode)
  if (!wireInput.checked) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, faceBuffer);
    gl.uniform1f(cubeUniforms.edge, 0);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
  }
  // White edges
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeBuffer);
  gl.uniform1f(cubeUniforms.edge, 1);
  gl.drawElements(gl.LINES, 24, gl.UNSIGNED_SHORT, 0);
}

// Pointer events work with mouse and touch
if (cubeGL) {
  cubeCanvas.addEventListener("pointerdown", function (event) {
    dragging = true;
    cubeCanvas.setPointerCapture(event.pointerId);
  });
  cubeCanvas.addEventListener("pointermove", function (event) {
    if (!dragging) return;
    velocity = [event.movementY * 0.01, event.movementX * 0.01];
    rotation[0] += velocity[0];
    rotation[1] += velocity[1];
  });
  cubeCanvas.addEventListener("pointerup", function () { dragging = false; });
}

const infoText = document.getElementById("cube-info");

function updateInfo() {
  infoText.textContent = wireInput.checked
    ? "8 vertices - 12 lines - 24 indices"
    : "8 vertices - 12 triangles - 36 indices";
}
wireInput.addEventListener("change", updateInfo);
updateInfo();

document.querySelectorAll(".swatch").forEach(function (button) {
  button.addEventListener("click", function () {
    color = button.dataset.color.split(",").map(Number);
  });
});

// ---------- Animation loop ----------
let frameId;

// Keep spinning after a throw, then slow down
function updateRotation() {
  if (!dragging) {
    rotation[0] += velocity[0];
    rotation[1] += velocity[1] + speedInput.value * 0.002;
  }
  velocity[0] *= 0.93;
  velocity[1] *= 0.93;
}

function frame(time) {
  updateRotation();
  if (heroGL) drawHero(time / 1000);
  if (cubeGL) drawCube();
  frameId = requestAnimationFrame(frame);
}

// Stop drawing when the tab is hidden
document.addEventListener("visibilitychange", function () {
  if (document.hidden) cancelAnimationFrame(frameId);
  else frameId = requestAnimationFrame(frame);
});

// ---------- Scroll animation (Intersection Observer API) ----------
const observer = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) entry.target.classList.add("visible");
  });
}, { threshold: 0.15 });

document.querySelectorAll(".reveal").forEach(function (element) {
  observer.observe(element);
});

if (heroGL) resizeHero();
frameId = requestAnimationFrame(frame);

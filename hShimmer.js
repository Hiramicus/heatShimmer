//  Heat shimmer demo

var canvas;
var gl;

// Here are a few variables to determine how to rotate the model based on how
// the user drags the mouse on the canvas.
var modelRotationX = 0; // How much to rotate around the x-axis.
var modelRotationY = 0; // How much to rotate around the y-axis.
var dragging = false;   // Records whether the mouse is dragging.
var lastClientX;        // Records the last x position of the mouse.
var lastClientY;        // Records the last y position of the mouse. 

// These are the various shaders we use for our demo.
// 
// The plainShader is a do-nothing postprocess effect. It simply renders the
// offscreen buffer onto a square (which serves as our screen).
// 
// The texture shader is our main drawing shader. It's equipped to draw objects
// that include three textures, a diffuse color texture, a specular texture, and
// a normal texture. The single texture shader is there to draw simple objects
// that don't need all of these.
//
// The hotAreaShader is used to draw a silhouette of the hot object that is
// bigger than the one drawn normally. It's there to cover the area that needs
// to be distored.
//
// The heatShader actually applies the heat shimmering postprocess effect to the
// scene, determining which pixels actually need to be distorted.
var plainShader;
var textureShader;
var singleTextureShader;
var hotAreaShader;
var heatShader;

// These are the models used to showcase the effect.
var screen;      // This is the only model that is drawn on screen. The scene
                 // is drawn offscreen, postprocess effects are applied, and
		 // then the resulting texture is applied to this model.
var teapotModel; // This is the model that will shimmer.
var roomModel;   // This serves as a background.
var chairModel;  // This is an obstacle between the viewer and the teapot.

var colorTexture;
var depthTexture;
var frameBuffer;
var displaceTexture;
var bgColorTex;
var bgDepthTex;
var bgFrameB;

var up = 0; // This makes the distorion animate upwards.

// This function lets us get a single array out of an array of arrays. The GPU
// actually works on only flat arrays, so this function constructs that out of
// the model data.
function flatten(a)
{
  return a.reduce(function (b, v) { b.push.apply(b, v); return b }, [])
}

// User interactivity function. It records that the mouse button was pressed,
// then makes a note of the coordinates.
function onmousedown(ev)
{
  dragging = true;
  lastClientX = ev.clientX;
  lastClientY = ev.clientY;
}

// This triggers when the user lets go of the mouse button and allows us to stop
// rotating the object.
function onmouseup(ev)
{
  dragging = false; 
}

// This is called whenever the mouse moves. Its goal is to calculate how much
// the model should rotate by.
function onmousemove(ev)
{
  if(dragging)
  {
    // Delta x and y. They record how much the mouse was moved.
    var dX = ev.clientX - lastClientX;
    var dY = ev.clientY - lastClientY;

    // The modelRotation variables record absolute rotation, not just change,
    // yet we only calculated change above. This is why we need to keep the old
    // value.
    modelRotationY = modelRotationY + dX;
    modelRotationX = modelRotationX + dY;

    // Rotating the object completely upside down reverses the left and right
    // directions, confusing the relationship between dragging and rotation. We
    // avoid this by simply not allowing the object to freely spin around the
    // x-axis.
    if(modelRotationX > 90.0)
    {
      modelRotationX = 90.0;
    }
    if(modelRotationX < -90.0)
    {
      modelRotationX = -90.0;
    }
    draw(); // Updating image.
  }
  // Recording the current position so that we can compute the change in
  // position later.
  lastClientX = ev.clientX;
  lastClientY = ev.clientY;
}

// Like the model constructor, this Shader constructor tests all possible
// locations that a shader could have, trusting that WebGL will return a value
// of -1 if the variable is not present.  This allows us to generalize the
// shader.setup and model.draw methods. 

function Shader(vertexShaderId, fragmentShaderId, modelVar, circumVar)
{
  // We need the source code for the shaders, which are stored as scripts in
  // the html file. We then create a program, which means compiling, linking,
  // and loading the shaders.
  var vertexSource = document.getElementById(vertexShaderId).text;
  var fragmentSource = document.getElementById(fragmentShaderId).text;
  this.program = createProgram(gl, vertexSource, fragmentSource);
  gl.useProgram(this.program);

  this.projectionMatrixLocation = gl.getUniformLocation(this.program,"projectionMatrix");
  this.viewMatrixLocation       = gl.getUniformLocation(this.program,"viewMatrix");
  this.modelMatrixLocation      = gl.getUniformLocation(this.program,"modelMatrix");
  this.normalMatrixLocation     = gl.getUniformLocation(this.program,"normalMatrix");
  this.lightPositionLocation    = gl.getUniformLocation(this.program,"lightPosition");
  this.shiftLocation            = gl.getUniformLocation(this.program,"shift");

  this.vertexPositionLocation = gl.getAttribLocation(this.program, "vertexPosition");
  this.vertexNormalLocation   = gl.getAttribLocation(this.program, "vertexNormal");
  this.vertexTexCoordLocation = gl.getAttribLocation(this.program, "vertexTexCoord");
  this.vertexTangentLocation  = gl.getAttribLocation(this.program, "vertexTangent");

  this.diffuseTextureLocation  = gl.getUniformLocation(this.program, 'diffuseTexture');
  this.specularTextureLocation = gl.getUniformLocation(this.program, 'specularTexture');
  this.normalTextureLocation   = gl.getUniformLocation(this.program, 'normalTexture'); 

  this.colorTextureLocation    = gl.getUniformLocation(this.program, 'colorTexture');
  this.depthTextureLocation    = gl.getUniformLocation(this.program, 'depthTexture');
  this.hotAreaColorTexLocation = gl.getUniformLocation(this.program, 'hotAreaColorTex');
  this.hotAreaDepthTexLocation = gl.getUniformLocation(this.program, 'hotAreaDepthTex');
  this.displaceTextureLocation = gl.getUniformLocation(this.program, 'displaceTexture');
  this.bgColorTexLocation      = gl.getUniformLocation(this.program, 'bgColorTex');
}

Shader.prototype.setup = function (projectionMatrix, viewMatrix, modelMatrix, normalMatrix, lightPosition)
{
  gl.useProgram(this.program);
	// Handles matrix uniforms.
  var setMatrices = function (loc, M) {
    if(loc != -1)
    {
      gl.uniformMatrix4fv(loc, false, M.elements);
    }
  }
  setMatrices(this.projectionMatrixLocation, projectionMatrix);
  setMatrices(this.viewMatrixLocation, viewMatrix);
  setMatrices(this.modelMatrixLocation, modelMatrix);
  setMatrices(this.normalMatrixLocation, normalMatrix);

  if(this.lightPositionLocation != -1)
  {
    gl.uniform4fv(this.lightPositionLocation, lightPosition);
  }

	// This innocuous-looking uniform is actually quite important.
	// It's simply an integer (in the JS) that varies between 0 and
	// 512 and always goes up each frame. This is passed to the heat
	// fragment shader to modulate the displacement in such a way
	// that the distortion appears to be moving upwards. It takes
	// advantage of a repeat wrap mode so that texture Coordinates
	// whose value goes above 512 grab the correct displacement
	// texture texel.
  if(this.shiftLocation != -1)
  {
    gl.uniform1f(this.shiftLocation, up++ % 512);
  }

	// This generalization of how to handle varying textures is very
	// useful.
	// First, so that we can use the index in our loop to denote
	// texture units without using a switch statement, we create an
	// array of texture unit constants.
  var texUnits = [gl.TEXTURE0, gl.TEXTURE1, gl.TEXTURE2, gl.TEXTURE3,
    gl.TEXTURE4, gl.TEXTURE5, gl.TEXTURE6, gl.TEXTURE7, gl.TEXTURE8];

	// Then we start counting textures and binding them to texture
	// units, going up the ladder. This way, when we write the sampler
	// uniform, we can use the index, being confident that the unit
	// and sampler integer match.
  var currTexUnitInt = 0;
  var setSamplerAndTex = function (loc, tex) {
    if(loc != -1)
    {
      gl.activeTexture(texUnits[currTexUnitInt]);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, currTexUnitInt);
      currTexUnitInt++;
    }
  }

  setSamplerAndTex(this.colorTextureLocation, colorTexture);
  setSamplerAndTex(this.depthTextureLocation, depthTexture);
  setSamplerAndTex(this.hotAreaColorTexLocation, hotAreaColorTex);
  setSamplerAndTex(this.hotAreaDepthTexLocation, hotAreaDepthTex);
  setSamplerAndTex(this.displaceTextureLocation, displaceTexture);
  setSamplerAndTex(this.bgColorTexLocation, bgColorTex);

	// Last, we add a property to our shader to denote how many
	// texture units this shader has used up. This value is used
	// in the model.draw function so that when we load the model textures
	// we use empty texture units.
  this.samplersSet = currTexUnitInt;
}

// Much like the shader constructor, we generalize this by testing
// whether the given model data or images are actually available and
// only if they are creating the appropriate buffers.
function Model(modelData, imageSources)
{
  var createBufferWithData = function (arrayInModel)
  {
    if(arrayInModel != undefined)
    {
      var flatArray = new Float32Array(flatten(arrayInModel));
      var theBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, theBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, flatArray, gl.STATIC_DRAW);
      return theBuffer;
    }
    else
      return null;
  }

  this.positionBuffer = createBufferWithData(modelData.positions);
  this.normalBuffer   = createBufferWithData(modelData.normals);
  this.texCoordBuffer = createBufferWithData(modelData.texCoords);
  this.tangentBuffer  = createBufferWithData(modelData.tangents);

  var triangleArray = new  Uint16Array(flatten(modelData.triangles));
  this.tnum = triangleArray.length;
  this.triangleBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triangleBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, triangleArray, gl.STATIC_DRAW);

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  var createTextureWithImage = function (anImageSource)
  {
    if(anImageSource != undefined)
    {
      var theTexture = gl.createTexture();
      initTexture(theTexture, anImageSource);
      return theTexture;
    }
    else
      return null;
  }

  if(imageSources != undefined)
  {
    this.diffuseTexture  = createTextureWithImage(imageSources.diffuse);
    this.specularTexture = createTextureWithImage(imageSources.specular);
    this.normalTexture   = createTextureWithImage(imageSources.normal);
  }
}

// Again, for the sake of generalization, we test every location but only
// set the vertex attributes and texture units that actually apply to
// the model.
Model.prototype.draw = function(shader)
{
  gl.useProgram(shader.program);

	// This time, we keep track of the locations set so that we can later
	// disable the vertexAttribArrays.
  var usedLocations = [];
  var setVertexAttrib = function (buffer, loc, dimension)
  {
    if(loc != -1)
    {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(loc, dimension, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(loc);
      usedLocations.push(loc);
    }
  }
  setVertexAttrib(this.positionBuffer, shader.vertexPositionLocation, 3);
  setVertexAttrib(this.normalBuffer, shader.vertexNormalLocation, 3);
  setVertexAttrib(this.texCoordBuffer, shader.vertexTexCoordLocation, 2);
  setVertexAttrib(this.tangentBuffer, shader.vertexTangentLocation, 3);
  
	// This is much like the texture binding for the shader, but we start
	// using an offset determined by the shader to make sure we don't
	// overwrite any previous texture bindings.
  var texUnits = [gl.TEXTURE0, gl.TEXTURE1, gl.TEXTURE2, gl.TEXTURE3,
    gl.TEXTURE4, gl.TEXTURE5, gl.TEXTURE6, gl.TEXTURE7, gl.TEXTURE8]; 
  var currTexUnitInt = shader.samplersSet;
  var setSamplerAndTex = function (loc, tex) {
    if(loc != -1)
    {
      gl.activeTexture(texUnits[currTexUnitInt]);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, currTexUnitInt);
      currTexUnitInt++;
    }
  }
  setSamplerAndTex(shader.diffuseTextureLocation, this.diffuseTexture);
  setSamplerAndTex(shader.specularTextureLocation, this.specularTexture);
  setSamplerAndTex(shader.normalTextureLocation, this.normalTexture);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triangleBuffer);
  gl.drawElements(gl.TRIANGLES, this.tnum, gl.UNSIGNED_SHORT, 0);

	// Some winter cleaning.
  var i;
  for(i = 0; i < usedLocations.length; i += 1)
    gl.disableVertexAttribArray(usedLocations[i]);
}

function loadTexture(texture, image)
{
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

function initTexture(texture, imageSource)
{
  var image = new Image();

  image.onload = function ()
  {
    loadTexture(texture, image);
  }
  image.crossOrigin = "anonymous";
  image.src = imageSource;
}


function setCommonTexParameters()
{
  // This function has changed! I've set The wrap mode is set to repeat
  // so that the displacement texture works correctly.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
}

function createFramebufferWithTex(colorT, depthT)
{
  gl.bindTexture(gl.TEXTURE_2D, colorT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  setCommonTexParameters();
  gl.bindTexture(gl.TEXTURE_2D, depthT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, 512, 512, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  setCommonTexParameters();
  
  var frameB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorT, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthT, 0);
  return frameB;
}

function init()
{
  // We first need a WebGL rendering context.
  canvas = document.getElementById('webgl');
  gl = getWebGLContext(canvas, true);
  gl.getExtension('WEBGL_depth_texture');

  canvas.onmousedown = onmousedown;
  canvas.onmouseup   = onmouseup;
  canvas.onmousemove = onmousemove;

	// Shader creation and initialization.
  singleTextureShader = new Shader('singleTextureVertexShader', 'singleTextureFragmentShader');
  textureShader  = new Shader('textureVertexShader', 'textureFragmentShader');
  plainShader = new Shader('plainVertexShader', 'plainFragmentShader');
  hotAreaShader = new Shader('hotAreaVertexShader', 'hotAreaFragmentShader');
  heatShader = new Shader('plainVertexShader', 'heatFragmentShader');

	// Model creation and initialization, including textures.
  var roomImages = {
    diffuse  : 'room_COLOR.jpg',
    specular : 'room_SPEC.jpg',
    normal   : 'room_NRM.jpg'
  };
  var teapotImages = {
    diffuse  : 'metal1_notile_COLOR.jpg',
    specular : 'metal1_notile_SPEC.jpg',
    normal   : 'metal1_notile_NRM.jpg',
  };
  var chairImages = {
    diffuse  : 'wood_texture_004_COLOR.jpg',
    specular : 'wood_texture_004_SPEC.jpg',
    normal   : 'wood_texture_004_NRM.jpg',
  };
  screen      = new Model(square);
  roomModel   = new Model(simpleRoom, roomImages);
  teapotModel = new Model(teapot, teapotImages);
  chairModel  = new Model(chair, chairImages);

	// We have a few frame buffer objects now.
	// First, our regular frame buffer, used before post-processing.
  colorTexture = gl.createTexture();
  depthTexture = gl.createTexture();
  frameBuffer = createFramebufferWithTex(colorTexture, depthTexture);
	// And then two buffers for the heat effect. The bg buffer is the
	// background buffer and stores image data behind the shimmering
	// object. The hotArea buffer allows us to determine where to apply
	// the heat distortion.
  hotAreaColorTex = gl.createTexture();
  hotAreaDepthTex = gl.createTexture();
  hotAreaFrameB = createFramebufferWithTex(hotAreaColorTex, hotAreaDepthTex);
  bgColorTex = gl.createTexture();
  bgDepthTex = gl.createTexture();
  bgFrameB = createFramebufferWithTex(bgColorTex, bgDepthTex);

	// This is a texture needed in order to calculate displacement.
  displaceTexture = gl.createTexture();
  initTexture(displaceTexture, 'blurred.jpeg');

	// This function is responsible for animation.
  var tick = function ()
  {
    draw();
    requestAnimationFrame(tick);
  }

  tick();
}

function draw()
{

  currModel = teapotModel;
	// Shader selection
  if(document.getElementById("heatToggle").checked)
	  currentShader = heatShader;
	else
	  currentShader = plainShader;

	// Light position acquisition
  var xSlider = document.getElementById("xSlider");
  var ySlider = document.getElementById("ySlider");
  var zSlider = document.getElementById("zSlider");
  var lightPosition = [xSlider.value, ySlider.value, zSlider.value, 1.0];

	// Matrices to be used for transforms. We now use a background model Matrix
	// to avoid shifting the background when we drag with the mouse. More
	// importantly, we now have a normal matrix, which is the inverse of the
	// transpose of the model matrix, used to transform the normals in our
	// heat fragment shader.
  var projectionMatrix = new Matrix4();
  var viewMatrix       = new Matrix4();
  var rotateX          = new Matrix4();
  var rotateY          = new Matrix4();
  var modelMatrix      = new Matrix4();
  var bgModelMatrix    = new Matrix4();
  var normalMatrix     = new Matrix4();

  projectionMatrix.setPerspective(45, 1, 1, 20);
  viewMatrix.setTranslate(0, -1, -7);

  rotateX.setRotate(modelRotationX, 1, 0, 0);
  rotateY.setRotate(modelRotationY, 0, 1, 0);
  modelMatrix.translate(0, 1.0, 0).concat(rotateX.concat(rotateY)); 

	// Setting the normal matrix.
  normalMatrix.setInverseOf(modelMatrix);
  normalMatrix.transpose();

	// Using the heat shader is considerably more complex than applying
	// a post-process effect, so we need to encapsulate that here.
  var useHeatShader = function ()
  {
	// First we draw the model to a hot area frame buffer, making it so
	// that we can see where in space the object casts heat.
    gl.bindFramebuffer(gl.FRAMEBUFFER, hotAreaFrameB);
    gl.viewport(0, 0, 512, 512); 
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    hotAreaShader.setup(projectionMatrix, viewMatrix, modelMatrix, normalMatrix, lightPosition);
    currModel.draw(hotAreaShader);

    // Here, we draw the background scene, including the shimmering object,
		// to a separate background frame buffer.
    gl.bindFramebuffer(gl.FRAMEBUFFER, bgFrameB);
    gl.viewport(0, 0, 512, 512); 
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    textureShader.setup(projectionMatrix, viewMatrix, bgModelMatrix, normalMatrix, lightPosition);
    roomModel.draw(textureShader);
    singleTextureShader.setup(projectionMatrix, viewMatrix, modelMatrix, normalMatrix, lightPosition);
    currModel.draw(singleTextureShader);
  }
  if(currentShader == heatShader)
  {
    useHeatShader();
  }

  // Now we draw the scene to our regular frame buffer.
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
  gl.viewport(0, 0, 512, 512); 
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  textureShader.setup(projectionMatrix, viewMatrix, bgModelMatrix, normalMatrix, lightPosition);
  roomModel.draw(textureShader);
  singleTextureShader.setup(projectionMatrix, viewMatrix, modelMatrix, normalMatrix, lightPosition);
  currModel.draw(singleTextureShader);
  textureShader.setup(projectionMatrix, viewMatrix, bgModelMatrix.translate(0.6, 0, 1.8), normalMatrix, lightPosition);
  chairModel.draw(textureShader);

	// And finally we draw to the screen and apply the post process heat distortion effect, if selected.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

	// The heat distortion fragment shader will determine whether to distort the image or not
	// depending on the space where the heat is cast and its depth relative to the scene. Also,
	// it draws pixel data from the background so as to not refract something close to it from
	// the foreground.
  currentShader.setup(projectionMatrix, viewMatrix, modelMatrix, normalMatrix, lightPosition);
  screen.draw(currentShader);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

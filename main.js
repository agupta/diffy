(function () {
  "use strict";

  /*
   * Let's get something working and then add functionality procedurally.
   * Don't worry about concurrency/asynchronousity/GPU programming just yet.
   * Trust that this functionality can be added, even if it means refactoring,
   * stick to what you know first, and then as you learn about graphics
   * programming.
   */

  /*
   * Parameters that dictate the display of the particles:
   *
   * I expect these to be eventually dynamically set on pageload, but for now
   * these will be set to fixed values.
   *
   */

  // TODO: Write code for dynamic setting, this may need to be done after a few
  // frames have been drawn.

  // Eventually we want to let the user set these, and also actually use them
  // in our computation
  let PAUSED = false; // Pause/play button functionality.
  const TICKRATE = 1.0; // Effectively speed up or slow down the flow of time.
  const FORWARDBUFFERSIZE = 0; // Probably best to leave these for later.
  const BACKWARDBUFFERSIZE = 0;
  // The smaller, the more accurate the solution. Try 1/1024 if floating point
  // errors arise.
  const RESOLUTION = 1/128;
  const FRAMERATE = 60;

  // the origin is between the 400th and the 401th pixel in each dimension
  const ZOOM = 40;
  const [WIDTH, HEIGHT] = [800, 800];

  let particles = [];
  let circles = [];
  let t = 0;
  let numOfParticles = 0;

  // ...


  // TODO: Update the user input fields in the DOM

  // TODO: Use html5 storage to save and load these values.

  // TODO: Implement a reset button, that goes back to the dynamic setting.


  function binom (n, k) {
    // uses nCk = (n/k) * (n-1)C(k-1)
    if (k > n-k) {
      return binom(n, n-k);
    }
    if (k === 0) {
      return 1;
    }
    return n * binom(n-1, k-1) / k;
  };

  // See below for explanation of (x/y)InitialDerivatives, it is the same as
  // (x/y)Derivatives, in the special case t = 0.
  function Particle (xInitialDerivatives, yInitialDerivatives) {
    this.xInitialDerivatives = xInitialDerivatives;
    this.yInitialDerivatives = yInitialDerivatives;
  }

  /*
   * order is a nonnegative integer, and will always correspond to the order of
   * the derivative on the left hand side.
   *
   * variable is a character, "x", "y", (and maybe in the future "z")
   *
   * func is a javascript function that corresponds to the right hand side, and
   * takes, three arguments, t, xDerivatives, yDerivatives
   *
   * (x/y)Derivatives is an Array containing the zeroth derivative and the
   * first equationFor(X/Y).order - 1 derivatives.
   *
   * To illustrate with an example, for the differential equation
   *  y^(n) = f(t, x, x', ..., x^(m), y, y', ..., y^(n-1)).
   *
   * order = n, variable = "y",
   * xInitialDerivatives = [x, x', ... x^(m)],
   * yInitialDerivatives = [y, y', ..., y^(n-1)],
   * and func appropriately unpacks the Arrays and computes f with these values
   * and returns this as a float.
   *
   * Since it corresponds to a mathematical function, func is always a pure
   * function.
   *
   */
  function DifferentialEquation (order, variable, func) {
    this.order = order;
    this.variable = variable;
    this.compute = func;
  }

  function DifferentialEquationSystem (equations) {
    // for the moment lets assume 2 equations.
    [this.xEquation, this.yEquation] = equations;
  }

  // the reason for not shifting this to the constructor is perhaps the user
  // may want to change the equation while the particle is in motion
  Particle.prototype.bindSystem = function (system) {
    this.system = system;
  };

  function Solution (xInitialDerivatives, yInitialDerivatives, system) {
    this.values = new Map();

    this.xInitialDerivatives = xInitialDerivatives;
    this.yInitialDerivatives = yInitialDerivatives;

    this.system = system;
  }
  Solution.prototype.renderedTo = 0.0;
  Solution.prototype.cleanedTo = 0.0;
  Solution.prototype.getPositionAtTime = function (t, coord) {
    const timeBelow = Math.floor(t/RESOLUTION) * RESOLUTION;
    const timeAbove = timeBelow + RESOLUTION;

    if (this.values.has(t)) {
      return this.values.get(t)[coord];
    } else if (this.values.has(timeBelow) && this.values.has(timeAbove)) {
      // linear interpolation
      const valueBelow = this.values.get(timeBelow)[coord];
      const valueAbove = this.values.get(timeAbove)[coord];

      return (valueAbove + (t - timeBelow) * (valueAbove - valueBelow)
       / RESOLUTION);
    } else {
      throw new Error(`getPositionAtTime called with t = ${t} (outside range` +
        "of values)");
    }
  };
  Solution.prototype.getValue = function (t, coord) {
    return this.values.get(t)[coord];
  };
  Solution.prototype.setValue = function (t, coord, value) {
    if (this.values.has(t)) {
      this.values.get(t)[coord] = value;
    } else {
      const entry = {};
      entry[coord] = value;
      this.values.set(t, entry);
    }
  };
  Solution.prototype.removeValue = function (t, coord) {
    if (!this.values.has(t)) {
      throw new Error("removeValue called with a t not in values");
    } else {
      const point = this.values.get(t);
      if (Object.prototype.hasOwnProperty.call(point, coord)) {
        const coords = Object.keys(point).length;
        if (coords === 2) {
          delete point[coord];
        } else if (coords === 1) {
          this.values.delete(t);
        } else {
          throw new Error("point has wrong number of coordinates");
        }
      } else {
        throw new Error("removeValue called at point with coordinate missing");
      }
    }
  };
  Solution.prototype.getArrayOfValues = function (start, numberOfValues,
      coord) {
    const arr = [];
    while (numberOfValues > 0) {
      arr.push(this.getValue(start, coord));
      start += RESOLUTION;
      numberOfValues -= 1;
    }
    return arr;
  };
  Solution.prototype.tick = function (t) {
    // check if initial conditions have been entered.
    if (!this.values.has(0.0)) {
      this.initialConditions();
    }
    while (this.cleanedTo + RESOLUTION < this.renderedTo) {
      this.clean();
    }
    while (!this.iterationsComplete(t)) {
      this.iterate();
    }

    return [this.getPositionAtTime(t, "x"), this.getPositionAtTime(t, "y")];
  };


  // Because methods will require information from the path of
  // the particle, it makes sense for each method to return functions that will
  // become methods for particles.

  // Implement each numerical algorithm:
  // each reads this.system, and adds to this.solution.
  function EulerSolution (xInitialDerivatives, yInitialDerivatives, system) {
    Solution.call(this, xInitialDerivatives, yInitialDerivatives, system);
  }
  EulerSolution.prototype = Object.create(Solution.prototype);
  EulerSolution.prototype.constructor = EulerSolution;

  EulerSolution.prototype.initialConditions = function () {
    this.xInitialDerivatives.forEach((derivative, order) =>
      this.setValue(RESOLUTION*order, "x", EulerSolution.derivativeToValue(derivative, order, this.getArrayOfValues(0.0, order, "x")))
    );
    this.yInitialDerivatives.forEach((derivative, order) =>
      this.setValue(RESOLUTION*order, "y", EulerSolution.derivativeToValue(derivative, order, this.getArrayOfValues(0.0, order, "y")))
    );
  };
  EulerSolution.prototype.iterationsComplete = function (t) {
    // var threshold = (Math.ceil(t/RESOLUTION) + BUFFERSIZE) * RESOLUTION;


    // if (!this.values.has(threshold)) {
    //   return false;
    // } else {
    //   return (Object.keys(this.values.get(threshold)).length === 2)
    // }
    return this.renderedTo > t;
  };
  EulerSolution.prototype.iterate = function () {
    // convert values to derivatives at t=0
    // calculate xEquation.compute at t=0, with values

    // how many values do we need?

    // look at the orders, we will use that many values (starting at t, and
    // going up in increments of RESOLUTION)

    const xOrder = this.system.xEquation.order;
    const yOrder = this.system.yEquation.order;

    const xValues = this.getArrayOfValues(this.renderedTo, xOrder, "x");
    const yValues = this.getArrayOfValues(this.renderedTo, yOrder, "y");

    // make an array of derivatives from xValues;

    const xDerivatives = [];
    const yDerivatives = [];

    for (let i = 0; i < xOrder; i++) {
      xDerivatives.push(EulerSolution.valuesToDerivative(i, xValues.slice(0, i+1)));
    }
    for (let i = 0; i < yOrder; i++) {
      yDerivatives.push(EulerSolution.valuesToDerivative(i, yValues.slice(0, i+1)));
    }

    const x = EulerSolution.derivativeToValue(this.system.xEquation.compute(this.renderedTo, xDerivatives, yDerivatives), xOrder, xValues);
    const y = EulerSolution.derivativeToValue(this.system.yEquation.compute(this.renderedTo, xDerivatives, yDerivatives), yOrder, yValues);

    this.setValue(this.renderedTo + RESOLUTION*xOrder, "x", x);
    this.setValue(this.renderedTo + RESOLUTION*yOrder, "y", y);

    this.renderedTo += RESOLUTION;
  };
  EulerSolution.prototype.clean = function () {
    this.removeValue(this.cleanedTo, "x");
    this.removeValue(this.cleanedTo, "y");
    this.cleanedTo += RESOLUTION;
  };

  Particle.prototype.solveEuler = function () {
    const s = new EulerSolution(this.xInitialDerivatives, this.yInitialDerivatives, this.system);
    return s;
  };

  /* output a finite difference approximation for x^(n)_m as
   *
   *          n
   * (1/h^n)  Σ  C(n,i) (-1)^i x_m+n-i
   *         i=0
   *
   * values is an array containing [x_m, ..., x_(m+n)]
   * It is the same no matter if it is x or y.
   *
   *  takes as input:
   *    n, the order of the derivative to approximate
   *    values = [x_m, x_m+1, ..., x_m+n] (length = n+1)
   *  outputs:
   *    an approximation for x^(n)_m (x^(n) at m).
   *
   */
  EulerSolution.valuesToDerivative = function (n, values) {
    if (values.length !== (n+1)) {
      throw new Error("wrong number of values passed to valuesToDerivative");
    }
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      sum += binom(n, i) * (-1)**i * values[n-i];
    }
    return sum/(RESOLUTION**n);
  };
  /*
   * rearranges to
   *                        n
   *  x_m+n = h^n x^(n)_m - Σ (-1)^i C(n, i) x_m+n-i
   *                       i=1
   *
   * takes in derivative, n:
   * where derivative = x^(n)_m
   * and values = [x_m, x_m+1, ..., x_m+n-1]
   *
   * outputs x_m+n
   */
  EulerSolution.derivativeToValue = function (derivative, n,
      values) {
    if (values.length !== n) {
      throw new Error("wrong number of values passed to derivativeToValue");
    }
    let sum = 0;
    for (let i = 1; i<=n; i++) {
      sum += binom(n, i) * (-1) ** i * values[n-i];
    }
    return (RESOLUTION ** n) * derivative - sum;
  };

  Particle.prototype.solveRK4 = function () {
  };
  /*
  Particle.prototype.solve = function (method, params) {
    // usage: myDE.solve("euler", {}) <=> myDE.solveEuler({})
    var methods = {
      "euler": this.solveEuler,
      "rk4": this.solveRK4
    };
    return methods[method]();
  };*/

  function parseEquations (equationsInput) {
    // do some work
    // return new DifferentialEquationSystem(/* with some parameters */);
  }

  // TODO: Eventually get all the necessary information from the DOM, but we
  // will work with these equations for now.
  // var equationForX = parseEquation("x'' = 0.2 * y + x - 0.1 * x'");
  // var equationForY = parseEquation("y' = 1 - x + x' - y - t");


  // THE GUI bit

  const app = new PIXI.Application({height: HEIGHT, width: WIDTH});

  document.body.appendChild(app.view);

  const cartesianToGrid = function (x, y) {
  // this is a flip in the y axis, followed by a scale, followed by a translation
  // and its oddly satisfying.
    const translation = [WIDTH, HEIGHT].map((i) => ((i-1)/2));
    return [x, -y].map((i) => i * ZOOM).map((i, index) => i + translation[index]);
  };
  const gridToCartesian = function (x, y) {
    const translation = [WIDTH, HEIGHT].map((i) => ((i-1)/2));
    const [ex, wye] = [x, y].map((i, index) => i - translation[index]).map((i) => i/ZOOM);
    return [ex, -wye];
  };


  // UI

  const playPauseButton = document.querySelector("#play-pause-button");

  playPauseButton.addEventListener("click", function () {
  // toggle returns true or false the element has the class before toggling.
    if (playPauseButton.classList.toggle("paused")) {
    // did not have paused class
    // "Pause" button clicked
      playPauseButton.innerText = "Play";
      PAUSED = true;
    } else {
    // had paused class
      playPauseButton.innerText = "Pause";
      PAUSED = false;
    }
  });

  const derivativeNotation = function (n) {
    if (n <= 3) {
      return document.createTextNode("′".repeat(n)); // prime symbol (U+2032)
    } else if (n > 3) {
      const sup = document.createElement("sup");
      sup.appendChild(document.createTextNode(`(${n})`));
      return sup;
    }
  };


  // Really inelegant, but how much more elegant can it get?
  document.querySelectorAll(".change-derivative").forEach(function (btn) {
    btn.addEventListener("click", function () {

      // first letter of id e.g. #x-differential-equation -> x
      let variable = btn.parentNode.id[0]; 
      const initialConditionsSpan = document.querySelector(
          `#${variable}-initial-conditions`);

      if (btn.classList.contains("change-derivative-up")) {
        // UP
        options[variable + "Order"]++;
        options[variable + "Derivatives"].push("random");
        // GENERATE ANOTHER INITIAL CONDITION NODE AND ADD IT TO THE END.

        /*
         * e.g.
         * <span class="initial-condition" id="y-initial-condition-3">
         *  y′′′(0) = 
         *  <input type="number" step="any" autocomplete="off"
         *      placeholder="(random)">
         * </span>
         */
        let initialConditionSpan = document.createElement("span");
        initialConditionSpan.classList.add("initial-condition");
        initialConditionSpan.id = `${variable}-initial-condition-${
            options[variable+"Order"] - 1
            }`;

        let text1 = document.createTextNode(variable);
        initialConditionSpan.appendChild(text1);

        let text2 = derivativeNotation(options[variable+"Order"] - 1);
        initialConditionSpan.appendChild(text2);

        let text3 = document.createTextNode("(0) = ");
        initialConditionSpan.appendChild(text3);

        let input = document.createElement("input");
        input.type = "number";
        input.step = "any";
        input.autocomplete = "off";
        input.placeholder = "(random)";
        initialConditionSpan.appendChild(input);

        initialConditionSpan.normalize(); // merges the textnodes

        initialConditionsSpan.appendChild(initialConditionSpan);
      } else if (btn.classList.contains("change-derivative-down")) {
        // DOWN
        if (options[variable + "Order"] - 1 >= 0) { // never < 0
          options[variable + "Order"]--;
          options[variable + "Derivatives"].pop();
          // remove a child
          // TODO: Have a cache so initial conditions can be restored to what
          // they were if they were removed by decreasing the order of the
          // derivative.
          initialConditionsSpan.removeChild(initialConditionsSpan.lastElementChild);
        }
      } else {
        throw new Error("The HTML is messed up.");
      }

      // TODO: Perhaps disable the down button when the order is 0?

      const derivativeSpan = document.querySelector(`#${variable}-derivative`);
      derivativeSpan.replaceChild(derivativeNotation(options[variable+"Order"]),
          derivativeSpan.firstChild);

      
      setup();
    });
  });

  const options = {
    xEquation: "y[0] - x[0]",
    xOrder: 2,
    xDerivatives: ["random", "random"],
    yEquation: "x[0] - y[0]",
    yOrder: 2,
    yDerivatives: ["random", "random"]
  };

  // TODO: Prevent invalid characters input in the initial conditions.

  document.querySelectorAll(".initial-conditions").forEach(function (span) {
    span.addEventListener("input", function (e) {
      if (e.target.matches(".initial-condition > input")) {

        // the first character of the parent's span id
        let variable = e.target.parentNode.id[0];
        // the last character of the parent span's id.
        let index = parseInt(e.target.parentNode.id.slice(-1));
        let value = Number(e.target.value);
        console.log(e);
        if (e.target.value === "") {
          value = "random";
        }
        options[variable + "Derivatives"][index] = value;
        setup();
      }
    });
  })


  // both is the NodeList returned by querySelectorAll
  document.querySelectorAll(".rhs").forEach(function (rhs, _, both) {
    rhs.addEventListener("input", function () {
    // get system
      options.xEquation = both[0].value;
      options.yEquation = both[1].value;
      // setup with the system

      setup();
    });
  });

  const restartButton = document.querySelector("#restart");

  restartButton.addEventListener("click", setup);


  function loop (delta) {
    // [circles.x, circle.y] = cartesianToGrid(...particles[0].solution.tick(t));
    if (!PAUSED) {
      for (let i=0; i<numOfParticles; i++) {
        [circles[i].x, circles[i].y] = cartesianToGrid(...particles[i].solution.tick(t));
      }
      t += 1/60 * delta; // TODO: lookup what delta really is for accuracy;
    }
  }

  function setup () {
    // for (var i = app.stage.children.length - 1; i >= 0; i--) {  app.stage.removeChild(app.stage.children[i]);};

    app.ticker.remove(loop);

    for (let i = app.stage.children.length - 1; i >= 0; i--) {
      app.stage.removeChild(app.stage.children[i]);
    }

    t = 0;


    // use options
    // called everytime the GUI changes
    // reset the PIXI thing, repopulate particles,


    let equationSystem = parseEquations([options.xEquation, options.yEquation]);

    // we haven't implemented the parser yet, so we will hard code what we expect
    // it to do.

    // {
    //   let equationForX = new DifferentialEquation(2, "x", function (t, xDerivatives, yDerivatives) {
    //     return 0.2 * yDerivatives[0] + xDerivatives[0] - 0.1 * xDerivatives[1];
    //   });
    //   let equationForY = new DifferentialEquation(1, "y", function (t, xDerivatives, yDerivatives) {
    //     return 1.0 - xDerivatives[0] + xDerivatives[1] - yDerivatives[0] - t;
    //   });
    //   equationSystem = new DifferentialEquationSystem([equationForX, equationForY]);
    // };

    const equationForX = new DifferentialEquation(options.xOrder, "x",
        new Function("t", "x", "y",
            `if (typeof (${options.xEquation}) !== "number") {
              throw new Error("The x RHS does not evaluate to a number");
            };
            return ${options.xEquation};`));
    const equationForY = new DifferentialEquation(options.yOrder, "y",
        new Function("t", "x", "y",
            `if (typeof (${options.yEquation}) !== "number") {
              throw new Error("The y RHS does not evaluate to a number");
            };
            return ${options.yEquation};`));
    equationSystem = new DifferentialEquationSystem([equationForX, equationForY]);

    // TODO: Eventually populate this with the initial conditions as chosen by
    // the user, and get the necessary information from the DOM.
    // TODO: Eventually implement an unsophisticated initial condition generator
    // that gives the particles some solution
    // particles = [new Particle (options.xDerivatives, options.yDerivatives)];
    // initial conditions: at t = 0, x = 0, x' = 3, y = 2


    numOfParticles = (options.xDerivatives.includes("random") ||
        options.yDerivatives.includes("random")) ? 100 : 1;

    particles = new Array(numOfParticles).fill(null).map(function () {
      const xInitalDerivatives = options.xDerivatives.map( i => {
        if (i === "random") {
          return Math.random() * 2 - 1;
        }
        return i;
      })
      const yInitalDerivatives = options.yDerivatives.map( i => {
        if (i === "random") {
          return Math.random() * 2 - 1;
        }
        return i;
      })
      return new Particle(xInitalDerivatives, yInitalDerivatives);
    })


















    // particles = new Array(100).fill(null).map(function () {
    //   const xInitalDerivatives = new Array(options.xOrder + 1).fill(null).map(() => (Math.random() * 2 - 1));
    //   const yInitalDerivatives = new Array(options.yOrder + 1).fill(null).map(() => (Math.random() * 2 - 1));
    //   return new Particle(xInitalDerivatives, yInitalDerivatives);
    // });

    for (const p of particles) {
      p.bindSystem(equationSystem);
      p.solution = p.solveEuler();
    }

    circles = new Array(numOfParticles).fill(null).map(function () {
      const circle = new PIXI.Graphics();
      circle.beginFill(0xE03E52);
      circle.drawCircle(0, 0, 3);
      circle.endFill();

      app.stage.addChild(circle);

      return circle;
    });


    // implement

    app.ticker.add(loop);
  }

  setup();
}());

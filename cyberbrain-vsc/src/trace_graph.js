/*
If you want to modify this file, you may find it hard because the vis-network lib
is not imported directly, so you won't have auto-complete. Due to the limitation
 of vscode,
(https://github.com/microsoft/vscode/issues/72900#issuecomment-487140263)
it's impossible to import a file, as it requires sending http requests.

So I pretty much just rely on my IDE (PyCharm in this case) to provide the
definitions for me. In "Languages & Frameworks > JavaScript > Libraries", you
can add the local vis-network.js file as a library, so that PyCharm recognizes
the vis object, and can provide auto-complete. See
https://i.loli.net/2020/08/05/FBqXQpjk4YVLGRa.png

For other IDEs/editors, I believe it's possible to achieve a similar effect.

I would love to write webview code in TS as well, but so far TS support in vis-network
is poor, see: https://github.com/visjs/vis-network/issues/930

*/

// The .js suffix is needed to make import work in vsc webview.
import { TraceData } from "./trace_data.js";
import { displayValueInConsole } from "./value.js";

let cl = console.log;

const lineHeight = 40;

let options = {
  nodes: {
    shape: "box"
  },
  edges: {
    smooth: {
      type: "dynamic"
    },
    arrows: {
      to: {
        enabled: true,
        scaleFactor: 0.4,
        type: "triangle"
      }
    }
  },
  interaction: {
    hover: true
  },
  layout: {
    hierarchical: {
      direction: "UD", // From up to bottom.
      edgeMinimization: false, // true leads to loosely placed nodes.
      levelSeparation: lineHeight,
      treeSpacing: 50,
      nodeSpacing: 60
    }
  },
  physics: {
    hierarchicalRepulsion: {
      avoidOverlap: 0.5, // puts the least space around nodes to save space.
      nodeDistance: 50
    }
  },
  manipulation: {
    initiallyActive: true,
    addEdge: false,
    editEdge: false,
    addNode: false,
    deleteNode: false,
    deleteEdge: false,
    editNode: function(data, callback) {
      options.interaction.hover = false; // Solved #93.
      traceGraph.network.setOptions(options);
      // filling in the popup DOM elements
      document.getElementById("node-operation").innerHTML = "Edit Loop Counter";
      editNode(data, cancelNodeEdit, callback);
    }
  }
};

// A method to draw round corner rectangle on canvas.
// From https://stackoverflow.com/a/7838871/2142577.
CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
  if (w < 2 * r) {
    r = w / 2;
  }
  if (h < 2 * r) {
    r = h / 2;
  }
  this.beginPath();
  this.moveTo(x + r, y);
  this.arcTo(x + w, y, x + w, y + h, r);
  this.arcTo(x + w, y + h, x, y + h, r);
  this.arcTo(x, y + h, x, y, r);
  this.arcTo(x, y, x + w, y, r);
  this.closePath();
  return this;
};

let traceGraph;

window.addEventListener("message", event => {
  if (!event.data.hasOwnProperty("events")) {
    return; // Server ready message.
  }
  if (isDevMode) {
    cl(event.data);
  } else {
    // setTimeout(() => {
    //   console.clear();
    // }, 1000);
  }
  traceGraph = new TraceGraph(event.data);
  traceGraph.render();
});

class TraceGraph {
  constructor(data) {
    this.traceData = new TraceData(data);
    this.colorGenerator = new ColorGenerator(data.identifiers);
    this.nodes = new vis.DataSet([]);
    this.edges = new vis.DataSet([]);
    this.container = document.getElementById("vis");
    this.hoveredNodeId = undefined;
    this.network = null;
  }

  render() {
    this.nodes.clear();
    this.edges.clear();
    this.network = new vis.Network(
      this.container,
      {
        nodes: this.nodes,
        edges: this.edges
      },
      options
    );

    let nodesToShow = [];
    let edgesToShow = [];

    // Add loop counter nodes.
    for (const loop of this.traceData.loops) {
      nodesToShow.push({
        title: "Loop counter",
        id: loop.id,
        level: this.traceData.linenoMapping.get(loop.startLineno),
        label: loop.counter.toString(),
        loop: loop,
        color: {
          background: "white"
        }
      });
    }

    for (let event of this.traceData.visibleEventsArray) {
      nodesToShow.push(this.createNode(event));

      // Add edges.
      if (this.traceData.tracingResult.has(event.id)) {
        for (let source_event_id of this.traceData.tracingResult.get(
          event.id
        )) {
          edgesToShow.push({
            from: source_event_id,
            to: event.id,
            id: source_event_id + event.id
          });
        }
      }
    }

    this.nodes.add(nodesToShow);
    this.edges.add(edgesToShow);
    this.network.fit(); // Zooms out so all nodes fit on the canvas.

    // Whether we have kicked a move to avoid edge overlap.
    this.moved = false;

    /*
     Manually draw tooltips to show each node's value on the trace path.
     */
    this.network.on("afterDrawing", ctx => {
      const topNode = this.nodes.min("level");
      const topNodeLevel = topNode.level;
      const topNodePos = this.network.getPosition(topNode.id);

      ctx.font = "14px consolas";
      ctx.strokeStyle = "#89897d";
      const leftBoundary = this.getTraceGraphLeftBoundary();

      // Draws frame info https://github.com/laike9m/Cyberbrain/issues/17
      ctx.textAlign = "center";
      ctx.fillStyle = "#cfa138";
      ctx.fillText(
        `${this.traceData.frameMetadata.filename} ${this.traceData.frameMetadata.frame_name}`,
        0,
        topNodePos.y - 30
      );

      // Draw lineno nodes.
      for (let [lineno, ranking] of this.traceData.linenoMapping) {
        const centerX = Math.min(-150, leftBoundary - 10);
        const centerY = topNodePos.y + lineHeight * (ranking - topNodeLevel);
        ctx.fillStyle = "#95ACB9";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(lineno, centerX, centerY);
      }

      // Give a move to a top-level node to avoid nodes being placed on one line.
      // See https://github.com/laike9m/Cyberbrain/issues/29
      // Moving any node would work actually.
      if (!this.moved) {
        const ids = this.traceData.visibleEventsArray.map(event => event.id);
        const x_positions = Array.from(this.network.getPositions(ids)).map(
          ([_, pos]) => pos.x
        );
        // Checks whether all nodes are at the same horizontal positions.
        if (Math.max(x_positions) === Math.min(x_positions)) {
          this.network.moveNode(topNode.id, topNodePos.x - 30, topNodePos.y);
        }
        this.moved = true;
        this.network.fit();
      }

      // Align loop nodes vertically.
      let minLoopNodeX = Number.MAX_SAFE_INTEGER;
      for (let loop of this.traceData.loops) {
        minLoopNodeX = Math.min(
          minLoopNodeX,
          this.network.getPosition(loop.id).x
        );
      }
      for (let loop of this.traceData.loops) {
        this.network.moveNode(
          loop.id,
          minLoopNodeX,
          this.network.getPosition(loop.id).y
        );
      }

      if (this.hoveredNodeId === undefined) {
        return;
      }

      let [tracePathNodeIds, tracePathEdgeIds] = findNodesAndEdgesOnTracePath(
        this.network,
        this.edges,
        this.hoveredNodeId
      );
      tracePathNodeIds = Array.from(tracePathNodeIds);
      tracePathEdgeIds = Array.from(tracePathEdgeIds);

      this.network.setSelection(
        {
          nodes: tracePathNodeIds,
          edges: tracePathEdgeIds
        },
        {
          highlightEdges: false
        }
      );

      for (let node of this.nodes.get(tracePathNodeIds)) {
        if (node.repr === undefined) {
          continue;
        }
        let pos = this.network.getPosition(node.id);
        let rectX = pos.x + 10;
        let rectY = pos.y - 33;
        let rectWidth = ctx.measureText(node.repr).width + 20;
        let rectHeight = 25;

        ctx.fillStyle = "#f5f4ed";
        ctx.roundRect(rectX, rectY, rectWidth, rectHeight, 5).fill();
        ctx.roundRect(rectX, rectY, rectWidth, rectHeight, 5).stroke();
        ctx.fillStyle = "black";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Centers text at background rectangle's center.
        ctx.fillText(node.repr, rectX + rectWidth / 2, rectY + rectHeight / 2);
      }
    });

    this.network.on("hoverNode", event => {
      // If user is already hovering on a node, do nothing.
      if (this.hoveredNodeId !== undefined) {
        return;
      }
      let node = this.nodes.get(event.node);
      if (!node.hasOwnProperty("target")) {
        return;
      }
      this.hoveredNodeId = node.id;

      // highlight the current hoverd node's line on the editor
      vscode.postMessage({
        command: "Interaction behavior",
        interactionConfig: {
          type: "Hover",
          info: { lineno: node.lineno, relativePath: node.filename }
        }
      });

      // TODO: show values of all local variables at this point.
      displayValueInConsole(node);
    });

    this.network.on("blurNode", event => {
      // Remove the highlight of the current hovered node's line in the editor.
      vscode.postMessage({
        command: "Interaction behavior",
        interactionConfig: {
          type: "Unhover"
        }
      });

      this.hoveredNodeId = undefined;
    });

    // Only show edit button when clicking on loop counter nodes, otherwise hide it.
    this.network.on("click", event => {
      let selectedNode = this.nodes.get(event.nodes[0]);
      setTimeout(() => {
        if (selectedNode.loop === undefined) {
          document.querySelector(".vis-manipulation").style.display = "none";
        } else {
          document.querySelector(
            ".vis-manipulation .vis-edit .vis-label"
          ).innerText = "Edit loop counter";
        }
      }, 0);
    });
  }
  // end render

  // Get the left boundary in canvas of the leftmost node.
  getTraceGraphLeftBoundary() {
    const positions = this.network.getPositions(this.nodes.getIds());
    let leftBoundary = Infinity;
    let leftMostNodeId = null;
    for (let id in positions) {
      if (positions[id].x < leftBoundary) {
        leftBoundary = positions[id].x;
        leftMostNodeId = id;
      }
    }
    return this.network.getBoundingBox(leftMostNodeId).left;
  }

  createNode(event) {
    let node = {
      id: event.id,
      level: this.traceData.linenoMapping.get(event.lineno),
      lineno: event.lineno,
      label: buildLabelText(event),
      filename: this.traceData.frameMetadata.filename,
      target: event.target,
      // "value" is a reserved property, use "runtimeValue" instead.
      runtimeValue: event.value,
      repr: event.repr,
      offset: event.offset,
      type: event.type,
      color: {
        background: this.colorGenerator.getColor(event.target),
        hover: {
          // Right now we let color keeps unchanged when hovering. We may slightly
          // change the color to make the node obvious.
          background: this.colorGenerator.getColor(event.target)
        }
      }
    };

    if (node.type === "InitialValue") {
      node.level = 0;
    }

    // Shows return node differently
    if (event.type === "Return") {
      node.font = {
        color: "red",
        multi: "html"
      };
      node.color = {
        border: "red",
        background: "white"
      };
    }

    return node;
  }
}

///////////////////////// Loop counter editor operations /////////////////////////

function editNode(node, cancelAction, callback) {
  document.getElementById("node-label").value = node.label;
  document.getElementById("node-saveButton").onclick = saveNodeData.bind(
    this,
    node,
    callback
  );
  document.getElementById("node-cancelButton").onclick = cancelAction.bind(
    this,
    callback
  );
  let popUp = document.getElementById("node-popUp");
  popUp.style.display = "block";

  // Insert instruction text to help users modify counters.
  let infoText = document.getElementById("counter_info");
  let infoTextNotExist = infoText === null;
  if (infoTextNotExist) {
    infoText = document.createElement("p");
    infoText.id = "counter_info";
  }
  infoText.innerText = `Counter max value: ${node.loop.maxCounter}`;
  infoText.hasWarning = false;
  if (infoTextNotExist) {
    popUp.insertBefore(infoText, null);
  }
}

function cancelNodeEdit(callback) {
  options.interaction.hover = true;
  clearNodePopUp();
  callback(null);
}

// TODO: Move node related functions into TraceGraph.
function saveNodeData(node, callback) {
  let userSetCounterText = document.getElementById("node-label").value;
  let userSetCounterValue = parseInt(userSetCounterText);
  options.interaction.hover = true;

  if (userSetCounterValue > node.loop.maxCounter) {
    let infoText = document.getElementById("counter_info");
    if (!infoText.hasWarning) {
      infoText.innerHTML =
        infoText.innerHTML +
        "<p style='color:red'>Counter exceeds upper limit</p>";
      infoText.hasWarning = true;
    }
    return;
  }
  node.loop.counter = userSetCounterValue;
  clearNodePopUp();
  callback(node);
  traceGraph.traceData.updateVisibleEvents(node.loop);
  traceGraph.render();
}

function clearNodePopUp() {
  document.getElementById("node-saveButton").onclick = null;
  document.getElementById("node-cancelButton").onclick = null;
  document.getElementById("node-popUp").style.display = "none";
}

///////////////////////// Helper functions/classes /////////////////////////

class ColorGenerator {
  constructor(identifiers) {
    let count = identifiers.length;
    let colors = randomColor({
      // Seed = 1000 generates acceptable colors.
      // See https://github.com/davidmerfield/randomColor/issues/136
      seed: 1000,
      count: count,
      luminosity: "light"
    });
    this.colorMap = new Map();
    for (let i = 0; i < count; i++) {
      this.colorMap.set(identifiers[i], colors[i]);
    }
  }

  getColor(identifier) {
    return this.colorMap.get(identifier);
  }
}

function buildLabelText(event) {
  return event.type === "Return" ? "<b>return</b>" : `${event.target}`;
}

/*
Given a node, find all node on the trace path. Here we not only find all sources nodes,
we also find all nodes that is a consequence of the given node, both directly and indirectly.
    A
   / \
  B  D
 /
C

Given the above graph and node "B", this function should return "A", "B", "C".

Trace graph does not have loop, so we don't need to check repeated nodes during recursion.
 */
function findNodesAndEdgesOnTracePath(
  network,
  edges,
  nodeId,
  directions = ["from", "to"]
) {
  let resultNodes = new Set([nodeId]);
  let resultEdges = new Set();

  for (let direction of directions) {
    for (let connectedNode of network.getConnectedNodes(nodeId, direction)) {
      if (direction === "from") {
        resultEdges.add(edges.get(connectedNode + nodeId).id);
      } else if (direction === "to") {
        resultEdges.add(edges.get(nodeId + connectedNode).id);
      }
      let [
        indirectConnectedNodes,
        indirectConnectedEdges
      ] = findNodesAndEdgesOnTracePath(network, edges, connectedNode, [
        direction
      ]);
      for (let indirectConnectedNode of indirectConnectedNodes) {
        resultNodes.add(indirectConnectedNode);
      }
      for (let indirectConnectedEdge of indirectConnectedEdges) {
        resultEdges.add(indirectConnectedEdge);
      }
    }
  }

  return [resultNodes, resultEdges];
}

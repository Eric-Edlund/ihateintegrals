/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./node_modules/ngraph.events/index.js":
/*!*********************************************!*\
  !*** ./node_modules/ngraph.events/index.js ***!
  \*********************************************/
/***/ ((module) => {

module.exports = function eventify(subject) {
  validateSubject(subject);

  var eventsStorage = createEventsStorage(subject);
  subject.on = eventsStorage.on;
  subject.off = eventsStorage.off;
  subject.fire = eventsStorage.fire;
  return subject;
};

function createEventsStorage(subject) {
  // Store all event listeners to this hash. Key is event name, value is array
  // of callback records.
  //
  // A callback record consists of callback function and its optional context:
  // { 'eventName' => [{callback: function, ctx: object}] }
  var registeredEvents = Object.create(null);

  return {
    on: function (eventName, callback, ctx) {
      if (typeof callback !== 'function') {
        throw new Error('callback is expected to be a function');
      }
      var handlers = registeredEvents[eventName];
      if (!handlers) {
        handlers = registeredEvents[eventName] = [];
      }
      handlers.push({callback: callback, ctx: ctx});

      return subject;
    },

    off: function (eventName, callback) {
      var wantToRemoveAll = (typeof eventName === 'undefined');
      if (wantToRemoveAll) {
        // Killing old events storage should be enough in this case:
        registeredEvents = Object.create(null);
        return subject;
      }

      if (registeredEvents[eventName]) {
        var deleteAllCallbacksForEvent = (typeof callback !== 'function');
        if (deleteAllCallbacksForEvent) {
          delete registeredEvents[eventName];
        } else {
          var callbacks = registeredEvents[eventName];
          for (var i = 0; i < callbacks.length; ++i) {
            if (callbacks[i].callback === callback) {
              callbacks.splice(i, 1);
            }
          }
        }
      }

      return subject;
    },

    fire: function (eventName) {
      var callbacks = registeredEvents[eventName];
      if (!callbacks) {
        return subject;
      }

      var fireArguments;
      if (arguments.length > 1) {
        fireArguments = Array.prototype.splice.call(arguments, 1);
      }
      for(var i = 0; i < callbacks.length; ++i) {
        var callbackInfo = callbacks[i];
        callbackInfo.callback.apply(callbackInfo.ctx, fireArguments);
      }

      return subject;
    }
  };
}

function validateSubject(subject) {
  if (!subject) {
    throw new Error('Eventify cannot use falsy object as events subject');
  }
  var reservedWords = ['on', 'fire', 'off'];
  for (var i = 0; i < reservedWords.length; ++i) {
    if (subject.hasOwnProperty(reservedWords[i])) {
      throw new Error("Subject cannot be eventified, since it already has property '" + reservedWords[i] + "'");
    }
  }
}


/***/ }),

/***/ "./node_modules/ngraph.graph/index.js":
/*!********************************************!*\
  !*** ./node_modules/ngraph.graph/index.js ***!
  \********************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

/**
 * @fileOverview Contains definition of the core graph object.
 */

// TODO: need to change storage layer:
// 1. Be able to get all nodes O(1)
// 2. Be able to get number of links O(1)

/**
 * @example
 *  var graph = require('ngraph.graph')();
 *  graph.addNode(1);     // graph has one node.
 *  graph.addLink(2, 3);  // now graph contains three nodes and one link.
 *
 */
module.exports = createGraph;

var eventify = __webpack_require__(/*! ngraph.events */ "./node_modules/ngraph.events/index.js");

/**
 * Creates a new graph
 */
function createGraph(options) {
  // Graph structure is maintained as dictionary of nodes
  // and array of links. Each node has 'links' property which
  // hold all links related to that node. And general links
  // array is used to speed up all links enumeration. This is inefficient
  // in terms of memory, but simplifies coding.
  options = options || {};
  if ('uniqueLinkId' in options) {
    console.warn(
      'ngraph.graph: Starting from version 0.14 `uniqueLinkId` is deprecated.\n' +
      'Use `multigraph` option instead\n',
      '\n',
      'Note: there is also change in default behavior: From now on each graph\n'+
      'is considered to be not a multigraph by default (each edge is unique).'
    );

    options.multigraph = options.uniqueLinkId;
  }

  // Dear reader, the non-multigraphs do not guarantee that there is only
  // one link for a given pair of node. When this option is set to false
  // we can save some memory and CPU (18% faster for non-multigraph);
  if (options.multigraph === undefined) options.multigraph = false;

  if (typeof Map !== 'function') {
    // TODO: Should we polyfill it ourselves? We don't use much operations there..
    throw new Error('ngraph.graph requires `Map` to be defined. Please polyfill it before using ngraph');
  } 

  var nodes = new Map(); // nodeId => Node
  var links = new Map(); // linkId => Link
    // Hash of multi-edges. Used to track ids of edges between same nodes
  var multiEdges = {};
  var suspendEvents = 0;

  var createLink = options.multigraph ? createUniqueLink : createSingleLink,

    // Our graph API provides means to listen to graph changes. Users can subscribe
    // to be notified about changes in the graph by using `on` method. However
    // in some cases they don't use it. To avoid unnecessary memory consumption
    // we will not record graph changes until we have at least one subscriber.
    // Code below supports this optimization.
    //
    // Accumulates all changes made during graph updates.
    // Each change element contains:
    //  changeType - one of the strings: 'add', 'remove' or 'update';
    //  node - if change is related to node this property is set to changed graph's node;
    //  link - if change is related to link this property is set to changed graph's link;
    changes = [],
    recordLinkChange = noop,
    recordNodeChange = noop,
    enterModification = noop,
    exitModification = noop;

  // this is our public API:
  var graphPart = {
    /**
     * Sometimes duck typing could be slow. Giving clients a hint about data structure
     * via explicit version number here:
     */
    version: 20.0,

    /**
     * Adds node to the graph. If node with given id already exists in the graph
     * its data is extended with whatever comes in 'data' argument.
     *
     * @param nodeId the node's identifier. A string or number is preferred.
     * @param [data] additional data for the node being added. If node already
     *   exists its data object is augmented with the new one.
     *
     * @return {node} The newly added node or node with given id if it already exists.
     */
    addNode: addNode,

    /**
     * Adds a link to the graph. The function always create a new
     * link between two nodes. If one of the nodes does not exists
     * a new node is created.
     *
     * @param fromId link start node id;
     * @param toId link end node id;
     * @param [data] additional data to be set on the new link;
     *
     * @return {link} The newly created link
     */
    addLink: addLink,

    /**
     * Removes link from the graph. If link does not exist does nothing.
     *
     * @param link - object returned by addLink() or getLinks() methods.
     *
     * @returns true if link was removed; false otherwise.
     */
    removeLink: removeLink,

    /**
     * Removes node with given id from the graph. If node does not exist in the graph
     * does nothing.
     *
     * @param nodeId node's identifier passed to addNode() function.
     *
     * @returns true if node was removed; false otherwise.
     */
    removeNode: removeNode,

    /**
     * Gets node with given identifier. If node does not exist undefined value is returned.
     *
     * @param nodeId requested node identifier;
     *
     * @return {node} in with requested identifier or undefined if no such node exists.
     */
    getNode: getNode,

    /**
     * Gets number of nodes in this graph.
     *
     * @return number of nodes in the graph.
     */
    getNodeCount: getNodeCount,

    /**
     * Gets total number of links in the graph.
     */
    getLinkCount: getLinkCount,

    /**
     * Gets total number of links in the graph.
     */
    getEdgeCount: getLinkCount,

    /**
     * Synonym for `getLinkCount()`
     */
    getLinksCount: getLinkCount,
    
    /**
     * Synonym for `getNodeCount()`
     */
    getNodesCount: getNodeCount,

    /**
     * Gets all links (inbound and outbound) from the node with given id.
     * If node with given id is not found null is returned.
     *
     * @param nodeId requested node identifier.
     *
     * @return Set of links from and to requested node if such node exists;
     *   otherwise null is returned.
     */
    getLinks: getLinks,

    /**
     * Invokes callback on each node of the graph.
     *
     * @param {Function(node)} callback Function to be invoked. The function
     *   is passed one argument: visited node.
     */
    forEachNode: forEachNode,

    /**
     * Invokes callback on every linked (adjacent) node to the given one.
     *
     * @param nodeId Identifier of the requested node.
     * @param {Function(node, link)} callback Function to be called on all linked nodes.
     *   The function is passed two parameters: adjacent node and link object itself.
     * @param oriented if true graph treated as oriented.
     */
    forEachLinkedNode: forEachLinkedNode,

    /**
     * Enumerates all links in the graph
     *
     * @param {Function(link)} callback Function to be called on all links in the graph.
     *   The function is passed one parameter: graph's link object.
     *
     * Link object contains at least the following fields:
     *  fromId - node id where link starts;
     *  toId - node id where link ends,
     *  data - additional data passed to graph.addLink() method.
     */
    forEachLink: forEachLink,

    /**
     * Suspend all notifications about graph changes until
     * endUpdate is called.
     */
    beginUpdate: enterModification,

    /**
     * Resumes all notifications about graph changes and fires
     * graph 'changed' event in case there are any pending changes.
     */
    endUpdate: exitModification,

    /**
     * Removes all nodes and links from the graph.
     */
    clear: clear,

    /**
     * Detects whether there is a link between two nodes.
     * Operation complexity is O(n) where n - number of links of a node.
     * NOTE: this function is synonym for getLink()
     *
     * @returns link if there is one. null otherwise.
     */
    hasLink: getLink,

    /**
     * Detects whether there is a node with given id
     * 
     * Operation complexity is O(1)
     * NOTE: this function is synonym for getNode()
     *
     * @returns node if there is one; Falsy value otherwise.
     */
    hasNode: getNode,

    /**
     * Gets an edge between two nodes.
     * Operation complexity is O(n) where n - number of links of a node.
     *
     * @param {string} fromId link start identifier
     * @param {string} toId link end identifier
     *
     * @returns link if there is one; undefined otherwise.
     */
    getLink: getLink
  };

  // this will add `on()` and `fire()` methods.
  eventify(graphPart);

  monitorSubscribers();

  return graphPart;

  function monitorSubscribers() {
    var realOn = graphPart.on;

    // replace real `on` with our temporary on, which will trigger change
    // modification monitoring:
    graphPart.on = on;

    function on() {
      // now it's time to start tracking stuff:
      graphPart.beginUpdate = enterModification = enterModificationReal;
      graphPart.endUpdate = exitModification = exitModificationReal;
      recordLinkChange = recordLinkChangeReal;
      recordNodeChange = recordNodeChangeReal;

      // this will replace current `on` method with real pub/sub from `eventify`.
      graphPart.on = realOn;
      // delegate to real `on` handler:
      return realOn.apply(graphPart, arguments);
    }
  }

  function recordLinkChangeReal(link, changeType) {
    changes.push({
      link: link,
      changeType: changeType
    });
  }

  function recordNodeChangeReal(node, changeType) {
    changes.push({
      node: node,
      changeType: changeType
    });
  }

  function addNode(nodeId, data) {
    if (nodeId === undefined) {
      throw new Error('Invalid node identifier');
    }

    enterModification();

    var node = getNode(nodeId);
    if (!node) {
      node = new Node(nodeId, data);
      recordNodeChange(node, 'add');
    } else {
      node.data = data;
      recordNodeChange(node, 'update');
    }

    nodes.set(nodeId, node);

    exitModification();
    return node;
  }

  function getNode(nodeId) {
    return nodes.get(nodeId);
  }

  function removeNode(nodeId) {
    var node = getNode(nodeId);
    if (!node) {
      return false;
    }

    enterModification();

    var prevLinks = node.links;
    if (prevLinks) {
      prevLinks.forEach(removeLinkInstance);
      node.links = null;
    }

    nodes.delete(nodeId);

    recordNodeChange(node, 'remove');

    exitModification();

    return true;
  }


  function addLink(fromId, toId, data) {
    enterModification();

    var fromNode = getNode(fromId) || addNode(fromId);
    var toNode = getNode(toId) || addNode(toId);

    var link = createLink(fromId, toId, data);
    var isUpdate = links.has(link.id);

    links.set(link.id, link);

    // TODO: this is not cool. On large graphs potentially would consume more memory.
    addLinkToNode(fromNode, link);
    if (fromId !== toId) {
      // make sure we are not duplicating links for self-loops
      addLinkToNode(toNode, link);
    }

    recordLinkChange(link, isUpdate ? 'update' : 'add');

    exitModification();

    return link;
  }

  function createSingleLink(fromId, toId, data) {
    var linkId = makeLinkId(fromId, toId);
    var prevLink = links.get(linkId);
    if (prevLink) {
      prevLink.data = data;
      return prevLink;
    }

    return new Link(fromId, toId, data, linkId);
  }

  function createUniqueLink(fromId, toId, data) {
    // TODO: Find a better/faster way to store multigraphs
    var linkId = makeLinkId(fromId, toId);
    var isMultiEdge = multiEdges.hasOwnProperty(linkId);
    if (isMultiEdge || getLink(fromId, toId)) {
      if (!isMultiEdge) {
        multiEdges[linkId] = 0;
      }
      var suffix = '@' + (++multiEdges[linkId]);
      linkId = makeLinkId(fromId + suffix, toId + suffix);
    }

    return new Link(fromId, toId, data, linkId);
  }

  function getNodeCount() {
    return nodes.size;
  }

  function getLinkCount() {
    return links.size;
  }

  function getLinks(nodeId) {
    var node = getNode(nodeId);
    return node ? node.links : null;
  }

  function removeLink(link, otherId) {
    if (otherId !== undefined) {
      link = getLink(link, otherId);
    }
    return removeLinkInstance(link);
  }

  function removeLinkInstance(link) {
    if (!link) {
      return false;
    }
    if (!links.get(link.id)) return false;

    enterModification();

    links.delete(link.id);

    var fromNode = getNode(link.fromId);
    var toNode = getNode(link.toId);

    if (fromNode) {
      fromNode.links.delete(link);
    }

    if (toNode) {
      toNode.links.delete(link);
    }

    recordLinkChange(link, 'remove');

    exitModification();

    return true;
  }

  function getLink(fromNodeId, toNodeId) {
    if (fromNodeId === undefined || toNodeId === undefined) return undefined;
    return links.get(makeLinkId(fromNodeId, toNodeId));
  }

  function clear() {
    enterModification();
    forEachNode(function(node) {
      removeNode(node.id);
    });
    exitModification();
  }

  function forEachLink(callback) {
    if (typeof callback === 'function') {
      var valuesIterator = links.values();
      var nextValue = valuesIterator.next();
      while (!nextValue.done) {
        if (callback(nextValue.value)) {
          return true; // client doesn't want to proceed. Return.
        }
        nextValue = valuesIterator.next();
      }
    }
  }

  function forEachLinkedNode(nodeId, callback, oriented) {
    var node = getNode(nodeId);

    if (node && node.links && typeof callback === 'function') {
      if (oriented) {
        return forEachOrientedLink(node.links, nodeId, callback);
      } else {
        return forEachNonOrientedLink(node.links, nodeId, callback);
      }
    }
  }

  // eslint-disable-next-line no-shadow
  function forEachNonOrientedLink(links, nodeId, callback) {
    var quitFast;

    var valuesIterator = links.values();
    var nextValue = valuesIterator.next();
    while (!nextValue.done) {
      var link = nextValue.value;
      var linkedNodeId = link.fromId === nodeId ? link.toId : link.fromId;
      quitFast = callback(nodes.get(linkedNodeId), link);
      if (quitFast) {
        return true; // Client does not need more iterations. Break now.
      }
      nextValue = valuesIterator.next();
    }
  }

  // eslint-disable-next-line no-shadow
  function forEachOrientedLink(links, nodeId, callback) {
    var quitFast;
    var valuesIterator = links.values();
    var nextValue = valuesIterator.next();
    while (!nextValue.done) {
      var link = nextValue.value;
      if (link.fromId === nodeId) {
        quitFast = callback(nodes.get(link.toId), link);
        if (quitFast) {
          return true; // Client does not need more iterations. Break now.
        }
      }
      nextValue = valuesIterator.next();
    }
  }

  // we will not fire anything until users of this library explicitly call `on()`
  // method.
  function noop() {}

  // Enter, Exit modification allows bulk graph updates without firing events.
  function enterModificationReal() {
    suspendEvents += 1;
  }

  function exitModificationReal() {
    suspendEvents -= 1;
    if (suspendEvents === 0 && changes.length > 0) {
      graphPart.fire('changed', changes);
      changes.length = 0;
    }
  }

  function forEachNode(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Function is expected to iterate over graph nodes. You passed ' + callback);
    }

    var valuesIterator = nodes.values();
    var nextValue = valuesIterator.next();
    while (!nextValue.done) {
      if (callback(nextValue.value)) {
        return true; // client doesn't want to proceed. Return.
      }
      nextValue = valuesIterator.next();
    }
  }
}

/**
 * Internal structure to represent node;
 */
function Node(id, data) {
  this.id = id;
  this.links = null;
  this.data = data;
}

function addLinkToNode(node, link) {
  if (node.links) {
    node.links.add(link);
  } else {
    node.links = new Set([link]);
  }
}

/**
 * Internal structure to represent links;
 */
function Link(fromId, toId, data, id) {
  this.fromId = fromId;
  this.toId = toId;
  this.data = data;
  this.id = id;
}

function makeLinkId(fromId, toId) {
  return fromId.toString() + '👉 ' + toId.toString();
}


/***/ }),

/***/ "./node_modules/ngraph.path/a-star/NodeHeap.js":
/*!*****************************************************!*\
  !*** ./node_modules/ngraph.path/a-star/NodeHeap.js ***!
  \*****************************************************/
/***/ ((module) => {

/**
 * Based on https://github.com/mourner/tinyqueue
 * Copyright (c) 2017, Vladimir Agafonkin https://github.com/mourner/tinyqueue/blob/master/LICENSE
 * 
 * Adapted for PathFinding needs by @anvaka
 * Copyright (c) 2017, Andrei Kashcha
 */
module.exports = NodeHeap;

function NodeHeap(data, options) {
  if (!(this instanceof NodeHeap)) return new NodeHeap(data, options);

  if (!Array.isArray(data)) {
    // assume first argument is our config object;
    options = data;
    data = [];
  }

  options = options || {};

  this.data = data || [];
  this.length = this.data.length;
  this.compare = options.compare || defaultCompare;
  this.setNodeId = options.setNodeId || noop;

  if (this.length > 0) {
    for (var i = (this.length >> 1); i >= 0; i--) this._down(i);
  }

  if (options.setNodeId) {
    for (var i = 0; i < this.length; ++i) {
      this.setNodeId(this.data[i], i);
    }
  }
}

function noop() {}

function defaultCompare(a, b) {
  return a - b;
}

NodeHeap.prototype = {

  push: function (item) {
    this.data.push(item);
    this.setNodeId(item, this.length);
    this.length++;
    this._up(this.length - 1);
  },

  pop: function () {
    if (this.length === 0) return undefined;

    var top = this.data[0];
    this.length--;

    if (this.length > 0) {
      this.data[0] = this.data[this.length];
      this.setNodeId(this.data[0], 0);
      this._down(0);
    }
    this.data.pop();

    return top;
  },

  peek: function () {
    return this.data[0];
  },

  updateItem: function (pos) {
    this._down(pos);
    this._up(pos);
  },

  _up: function (pos) {
    var data = this.data;
    var compare = this.compare;
    var setNodeId = this.setNodeId;
    var item = data[pos];

    while (pos > 0) {
      var parent = (pos - 1) >> 1;
      var current = data[parent];
      if (compare(item, current) >= 0) break;
        data[pos] = current;

       setNodeId(current, pos);
       pos = parent;
    }

    data[pos] = item;
    setNodeId(item, pos);
  },

  _down: function (pos) {
    var data = this.data;
    var compare = this.compare;
    var halfLength = this.length >> 1;
    var item = data[pos];
    var setNodeId = this.setNodeId;

    while (pos < halfLength) {
      var left = (pos << 1) + 1;
      var right = left + 1;
      var best = data[left];

      if (right < this.length && compare(data[right], best) < 0) {
        left = right;
        best = data[right];
      }
      if (compare(best, item) >= 0) break;

      data[pos] = best;
      setNodeId(best, pos);
      pos = left;
    }

    data[pos] = item;
    setNodeId(item, pos);
  }
};

/***/ }),

/***/ "./node_modules/ngraph.path/a-star/a-greedy-star.js":
/*!**********************************************************!*\
  !*** ./node_modules/ngraph.path/a-star/a-greedy-star.js ***!
  \**********************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

/**
 * Performs suboptimal, greed A Star path finding.
 * This finder does not necessary finds the shortest path. The path
 * that it finds is very close to the shortest one. It is very fast though.
 */
module.exports = aStarBi;

var NodeHeap = __webpack_require__(/*! ./NodeHeap */ "./node_modules/ngraph.path/a-star/NodeHeap.js");
var makeSearchStatePool = __webpack_require__(/*! ./makeSearchStatePool */ "./node_modules/ngraph.path/a-star/makeSearchStatePool.js");
var heuristics = __webpack_require__(/*! ./heuristics */ "./node_modules/ngraph.path/a-star/heuristics.js");
var defaultSettings = __webpack_require__(/*! ./defaultSettings */ "./node_modules/ngraph.path/a-star/defaultSettings.js");

var BY_FROM = 1;
var BY_TO = 2;
var NO_PATH = defaultSettings.NO_PATH;

module.exports.l2 = heuristics.l2;
module.exports.l1 = heuristics.l1;

/**
 * Creates a new instance of pathfinder. A pathfinder has just one method:
 * `find(fromId, toId)`, it may be extended in future.
 * 
 * NOTE: Algorithm implemented in this code DOES NOT find optimal path.
 * Yet the path that it finds is always near optimal, and it finds it very fast.
 * 
 * @param {ngraph.graph} graph instance. See https://github.com/anvaka/ngraph.graph
 * 
 * @param {Object} options that configures search
 * @param {Function(a, b)} options.heuristic - a function that returns estimated distance between
 * nodes `a` and `b`.  Defaults function returns 0, which makes this search equivalent to Dijkstra search.
 * @param {Function(a, b)} options.distance - a function that returns actual distance between two
 * nodes `a` and `b`. By default this is set to return graph-theoretical distance (always 1);
 * @param {Boolean} options.oriented - whether graph should be considered oriented or not.
 * 
 * @returns {Object} A pathfinder with single method `find()`.
 */
function aStarBi(graph, options) {
  options = options || {};
  // whether traversal should be considered over oriented graph.
  var oriented = options.oriented;

  var heuristic = options.heuristic;
  if (!heuristic) heuristic = defaultSettings.heuristic;

  var distance = options.distance;
  if (!distance) distance = defaultSettings.distance;
  var pool = makeSearchStatePool();

  return {
    find: find
  };

  function find(fromId, toId) {
    // Not sure if we should return NO_PATH or throw. Throw seem to be more
    // helpful to debug errors. So, throwing.
    var from = graph.getNode(fromId);
    if (!from) throw new Error('fromId is not defined in this graph: ' + fromId);
    var to = graph.getNode(toId);
    if (!to) throw new Error('toId is not defined in this graph: ' + toId);

    if (from === to) return [from]; // trivial case.

    pool.reset();

    var callVisitor = oriented ? orientedVisitor : nonOrientedVisitor;

    // Maps nodeId to NodeSearchState.
    var nodeState = new Map();

    var openSetFrom = new NodeHeap({
      compare: defaultSettings.compareFScore,
      setNodeId: defaultSettings.setHeapIndex
    });

    var openSetTo = new NodeHeap({
      compare: defaultSettings.compareFScore,
      setNodeId: defaultSettings.setHeapIndex
    });


    var startNode = pool.createNewState(from);
    nodeState.set(fromId, startNode);

    // For the first node, fScore is completely heuristic.
    startNode.fScore = heuristic(from, to);
    // The cost of going from start to start is zero.
    startNode.distanceToSource = 0;
    openSetFrom.push(startNode);
    startNode.open = BY_FROM;

    var endNode = pool.createNewState(to);
    endNode.fScore = heuristic(to, from);
    endNode.distanceToSource = 0;
    openSetTo.push(endNode);
    endNode.open = BY_TO;

    // Cost of the best solution found so far. Used for accurate termination
    var lMin = Number.POSITIVE_INFINITY;
    var minFrom;
    var minTo;

    var currentSet = openSetFrom;
    var currentOpener = BY_FROM;

    while (openSetFrom.length > 0 && openSetTo.length > 0) {
      if (openSetFrom.length < openSetTo.length) {
        // we pick a set with less elements
        currentOpener = BY_FROM;
        currentSet = openSetFrom;
      } else {
        currentOpener = BY_TO;
        currentSet = openSetTo;
      }

      var current = currentSet.pop();

      // no need to visit this node anymore
      current.closed = true;

      if (current.distanceToSource > lMin) continue;

      graph.forEachLinkedNode(current.node.id, callVisitor);

      if (minFrom && minTo) {
        // This is not necessary the best path, but we are so greedy that we
        // can't resist:
        return reconstructBiDirectionalPath(minFrom, minTo);
      }
    }

    return NO_PATH; // No path.

    function nonOrientedVisitor(otherNode, link) {
      return visitNode(otherNode, link, current);
    }

    function orientedVisitor(otherNode, link) {
      // For oritned graphs we need to reverse graph, when traveling
      // backwards. So, we use non-oriented ngraph's traversal, and 
      // filter link orientation here.
      if (currentOpener === BY_FROM) {
        if (link.fromId === current.node.id) return visitNode(otherNode, link, current)
      } else if (currentOpener === BY_TO) {
        if (link.toId === current.node.id) return visitNode(otherNode, link, current);
      }
    }

    function canExit(currentNode) {
      var opener = currentNode.open
      if (opener && opener !== currentOpener) {
        return true;
      }

      return false;
    }

    function reconstructBiDirectionalPath(a, b) {
      var pathOfNodes = [];
      var aParent = a;
      while(aParent) {
        pathOfNodes.push(aParent.node);
        aParent = aParent.parent;
      }
      var bParent = b;
      while (bParent) {
        pathOfNodes.unshift(bParent.node);
        bParent = bParent.parent
      }
      return pathOfNodes;
    }

    function visitNode(otherNode, link, cameFrom) {
      var otherSearchState = nodeState.get(otherNode.id);
      if (!otherSearchState) {
        otherSearchState = pool.createNewState(otherNode);
        nodeState.set(otherNode.id, otherSearchState);
      }

      if (otherSearchState.closed) {
        // Already processed this node.
        return;
      }

      if (canExit(otherSearchState, cameFrom)) {
        // this node was opened by alternative opener. The sets intersect now,
        // we found an optimal path, that goes through *this* node. However, there
        // is no guarantee that this is the global optimal solution path.

        var potentialLMin = otherSearchState.distanceToSource + cameFrom.distanceToSource;
        if (potentialLMin < lMin) {
          minFrom = otherSearchState;
          minTo = cameFrom
          lMin = potentialLMin;
        }
        // we are done with this node.
        return;
      }

      var tentativeDistance = cameFrom.distanceToSource + distance(otherSearchState.node, cameFrom.node, link);

      if (tentativeDistance >= otherSearchState.distanceToSource) {
        // This would only make our path longer. Ignore this route.
        return;
      }

      // Choose target based on current working set:
      var target = (currentOpener === BY_FROM) ? to : from;
      var newFScore = tentativeDistance + heuristic(otherSearchState.node, target);
      if (newFScore >= lMin) {
        // this can't be optimal path, as we have already found a shorter path.
        return;
      }
      otherSearchState.fScore = newFScore;

      if (otherSearchState.open === 0) {
        // Remember this node in the current set
        currentSet.push(otherSearchState);
        currentSet.updateItem(otherSearchState.heapIndex);

        otherSearchState.open = currentOpener;
      }

      // bingo! we found shorter path:
      otherSearchState.parent = cameFrom;
      otherSearchState.distanceToSource = tentativeDistance;
    }
  }
}


/***/ }),

/***/ "./node_modules/ngraph.path/a-star/a-star.js":
/*!***************************************************!*\
  !*** ./node_modules/ngraph.path/a-star/a-star.js ***!
  \***************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

/**
 * Performs a uni-directional A Star search on graph.
 * 
 * We will try to minimize f(n) = g(n) + h(n), where
 * g(n) is actual distance from source node to `n`, and
 * h(n) is heuristic distance from `n` to target node.
 */
module.exports = aStarPathSearch;

var NodeHeap = __webpack_require__(/*! ./NodeHeap */ "./node_modules/ngraph.path/a-star/NodeHeap.js");
var makeSearchStatePool = __webpack_require__(/*! ./makeSearchStatePool */ "./node_modules/ngraph.path/a-star/makeSearchStatePool.js");
var heuristics = __webpack_require__(/*! ./heuristics */ "./node_modules/ngraph.path/a-star/heuristics.js");
var defaultSettings = __webpack_require__(/*! ./defaultSettings.js */ "./node_modules/ngraph.path/a-star/defaultSettings.js");

var NO_PATH = defaultSettings.NO_PATH;

module.exports.l2 = heuristics.l2;
module.exports.l1 = heuristics.l1;

/**
 * Creates a new instance of pathfinder. A pathfinder has just one method:
 * `find(fromId, toId)`, it may be extended in future.
 * 
 * @param {ngraph.graph} graph instance. See https://github.com/anvaka/ngraph.graph
 * @param {Object} options that configures search
 * @param {Function(a, b)} options.heuristic - a function that returns estimated distance between
 * nodes `a` and `b`. This function should never overestimate actual distance between two
 * nodes (otherwise the found path will not be the shortest). Defaults function returns 0,
 * which makes this search equivalent to Dijkstra search.
 * @param {Function(a, b)} options.distance - a function that returns actual distance between two
 * nodes `a` and `b`. By default this is set to return graph-theoretical distance (always 1);
 * @param {Boolean} options.oriented - whether graph should be considered oriented or not.
 * 
 * @returns {Object} A pathfinder with single method `find()`.
 */
function aStarPathSearch(graph, options) {
  options = options || {};
  // whether traversal should be considered over oriented graph.
  var oriented = options.oriented;

  var heuristic = options.heuristic;
  if (!heuristic) heuristic = defaultSettings.heuristic;

  var distance = options.distance;
  if (!distance) distance = defaultSettings.distance;
  var pool = makeSearchStatePool();

  return {
    /**
     * Finds a path between node `fromId` and `toId`.
     * @returns {Array} of nodes between `toId` and `fromId`. Empty array is returned
     * if no path is found.
     */
    find: find
  };

  function find(fromId, toId) {
    var from = graph.getNode(fromId);
    if (!from) throw new Error('fromId is not defined in this graph: ' + fromId);
    var to = graph.getNode(toId);
    if (!to) throw new Error('toId is not defined in this graph: ' + toId);
    pool.reset();

    // Maps nodeId to NodeSearchState.
    var nodeState = new Map();

    // the nodes that we still need to evaluate
    var openSet = new NodeHeap({
      compare: defaultSettings.compareFScore,
      setNodeId: defaultSettings.setHeapIndex
    });

    var startNode = pool.createNewState(from);
    nodeState.set(fromId, startNode);

    // For the first node, fScore is completely heuristic.
    startNode.fScore = heuristic(from, to);

    // The cost of going from start to start is zero.
    startNode.distanceToSource = 0;
    openSet.push(startNode);
    startNode.open = 1;

    var cameFrom;

    while (openSet.length > 0) {
      cameFrom = openSet.pop();
      if (goalReached(cameFrom, to)) return reconstructPath(cameFrom);

      // no need to visit this node anymore
      cameFrom.closed = true;
      graph.forEachLinkedNode(cameFrom.node.id, visitNeighbour, oriented);
    }

    // If we got here, then there is no path.
    return NO_PATH;

    function visitNeighbour(otherNode, link) {
      var otherSearchState = nodeState.get(otherNode.id);
      if (!otherSearchState) {
        otherSearchState = pool.createNewState(otherNode);
        nodeState.set(otherNode.id, otherSearchState);
      }

      if (otherSearchState.closed) {
        // Already processed this node.
        return;
      }
      if (otherSearchState.open === 0) {
        // Remember this node.
        openSet.push(otherSearchState);
        otherSearchState.open = 1;
      }

      var tentativeDistance = cameFrom.distanceToSource + distance(otherNode, cameFrom.node, link);
      if (tentativeDistance >= otherSearchState.distanceToSource) {
        // This would only make our path longer. Ignore this route.
        return;
      }

      // bingo! we found shorter path:
      otherSearchState.parent = cameFrom;
      otherSearchState.distanceToSource = tentativeDistance;
      otherSearchState.fScore = tentativeDistance + heuristic(otherSearchState.node, to);

      openSet.updateItem(otherSearchState.heapIndex);
    }
  }
}

function goalReached(searchState, targetNode) {
  return searchState.node === targetNode;
}

function reconstructPath(searchState) {
  var path = [searchState.node];
  var parent = searchState.parent;

  while (parent) {
    path.push(parent.node);
    parent = parent.parent;
  }

  return path;
}


/***/ }),

/***/ "./node_modules/ngraph.path/a-star/defaultSettings.js":
/*!************************************************************!*\
  !*** ./node_modules/ngraph.path/a-star/defaultSettings.js ***!
  \************************************************************/
/***/ ((module) => {

// We reuse instance of array, but we trie to freeze it as well,
// so that consumers don't modify it. Maybe it's a bad idea.
var NO_PATH = [];
if (typeof Object.freeze === 'function') Object.freeze(NO_PATH);

module.exports = {
  // Path search settings
  heuristic: blindHeuristic,
  distance: constantDistance,
  compareFScore: compareFScore,
  NO_PATH: NO_PATH,

  // heap settings
  setHeapIndex: setHeapIndex,

  // nba:
  setH1: setH1,
  setH2: setH2,
  compareF1Score: compareF1Score,
  compareF2Score: compareF2Score,
}

function blindHeuristic(/* a, b */) {
  // blind heuristic makes this search equal to plain Dijkstra path search.
  return 0;
}

function constantDistance(/* a, b */) {
  return 1;
}

function compareFScore(a, b) {
  var result = a.fScore - b.fScore;
  // TODO: Can I improve speed with smarter ties-breaking?
  // I tried distanceToSource, but it didn't seem to have much effect
  return result;
}

function setHeapIndex(nodeSearchState, heapIndex) {
  nodeSearchState.heapIndex = heapIndex;
}

function compareF1Score(a, b) {
  return a.f1 - b.f1;
}

function compareF2Score(a, b) {
  return a.f2 - b.f2;
}

function setH1(node, heapIndex) {
  node.h1 = heapIndex;
}

function setH2(node, heapIndex) {
  node.h2 = heapIndex;
}

/***/ }),

/***/ "./node_modules/ngraph.path/a-star/heuristics.js":
/*!*******************************************************!*\
  !*** ./node_modules/ngraph.path/a-star/heuristics.js ***!
  \*******************************************************/
/***/ ((module) => {

module.exports = {
  l2: l2,
  l1: l1
};

/**
 * Euclid distance (l2 norm);
 * 
 * @param {*} a 
 * @param {*} b 
 */
function l2(a, b) {
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Manhattan distance (l1 norm);
 * @param {*} a 
 * @param {*} b 
 */
function l1(a, b) {
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  return Math.abs(dx) + Math.abs(dy);
}


/***/ }),

/***/ "./node_modules/ngraph.path/a-star/makeSearchStatePool.js":
/*!****************************************************************!*\
  !*** ./node_modules/ngraph.path/a-star/makeSearchStatePool.js ***!
  \****************************************************************/
/***/ ((module) => {

/**
 * This class represents a single search node in the exploration tree for
 * A* algorithm.
 * 
 * @param {Object} node  original node in the graph
 */
function NodeSearchState(node) {
  this.node = node;

  // How we came to this node?
  this.parent = null;

  this.closed = false;
  this.open = 0;

  this.distanceToSource = Number.POSITIVE_INFINITY;
  // the f(n) = g(n) + h(n) value
  this.fScore = Number.POSITIVE_INFINITY;

  // used to reconstruct heap when fScore is updated.
  this.heapIndex = -1;
};

function makeSearchStatePool() {
  var currentInCache = 0;
  var nodeCache = [];

  return {
    createNewState: createNewState,
    reset: reset
  };

  function reset() {
    currentInCache = 0;
  }

  function createNewState(node) {
    var cached = nodeCache[currentInCache];
    if (cached) {
      // TODO: This almost duplicates constructor code. Not sure if
      // it would impact performance if I move this code into a function
      cached.node = node;
      // How we came to this node?
      cached.parent = null;

      cached.closed = false;
      cached.open = 0;

      cached.distanceToSource = Number.POSITIVE_INFINITY;
      // the f(n) = g(n) + h(n) value
      cached.fScore = Number.POSITIVE_INFINITY;

      // used to reconstruct heap when fScore is updated.
      cached.heapIndex = -1;

    } else {
      cached = new NodeSearchState(node);
      nodeCache[currentInCache] = cached;
    }
    currentInCache++;
    return cached;
  }
}
module.exports = makeSearchStatePool;

/***/ }),

/***/ "./node_modules/ngraph.path/a-star/nba/index.js":
/*!******************************************************!*\
  !*** ./node_modules/ngraph.path/a-star/nba/index.js ***!
  \******************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

module.exports = nba;

var NodeHeap = __webpack_require__(/*! ../NodeHeap */ "./node_modules/ngraph.path/a-star/NodeHeap.js");
var heuristics = __webpack_require__(/*! ../heuristics */ "./node_modules/ngraph.path/a-star/heuristics.js");
var defaultSettings = __webpack_require__(/*! ../defaultSettings.js */ "./node_modules/ngraph.path/a-star/defaultSettings.js");
var makeNBASearchStatePool = __webpack_require__(/*! ./makeNBASearchStatePool.js */ "./node_modules/ngraph.path/a-star/nba/makeNBASearchStatePool.js");

var NO_PATH = defaultSettings.NO_PATH;

module.exports.l2 = heuristics.l2;
module.exports.l1 = heuristics.l1;

/**
 * Creates a new instance of pathfinder. A pathfinder has just one method:
 * `find(fromId, toId)`.
 * 
 * This is implementation of the NBA* algorithm described in 
 * 
 *  "Yet another bidirectional algorithm for shortest paths" paper by Wim Pijls and Henk Post
 * 
 * The paper is available here: https://repub.eur.nl/pub/16100/ei2009-10.pdf
 * 
 * @param {ngraph.graph} graph instance. See https://github.com/anvaka/ngraph.graph
 * @param {Object} options that configures search
 * @param {Function(a, b)} options.heuristic - a function that returns estimated distance between
 * nodes `a` and `b`. This function should never overestimate actual distance between two
 * nodes (otherwise the found path will not be the shortest). Defaults function returns 0,
 * which makes this search equivalent to Dijkstra search.
 * @param {Function(a, b)} options.distance - a function that returns actual distance between two
 * nodes `a` and `b`. By default this is set to return graph-theoretical distance (always 1);
 * 
 * @returns {Object} A pathfinder with single method `find()`.
 */
function nba(graph, options) {
  options = options || {};
  // whether traversal should be considered over oriented graph.
  var oriented = options.oriented;
  var quitFast = options.quitFast;

  var heuristic = options.heuristic;
  if (!heuristic) heuristic = defaultSettings.heuristic;

  var distance = options.distance;
  if (!distance) distance = defaultSettings.distance;

  // During stress tests I noticed that garbage collection was one of the heaviest
  // contributors to the algorithm's speed. So I'm using an object pool to recycle nodes.
  var pool = makeNBASearchStatePool();

  return {
    /**
     * Finds a path between node `fromId` and `toId`.
     * @returns {Array} of nodes between `toId` and `fromId`. Empty array is returned
     * if no path is found.
     */
    find: find
  };

  function find(fromId, toId) {
    // I must apologize for the code duplication. This was the easiest way for me to
    // implement the algorithm fast.
    var from = graph.getNode(fromId);
    if (!from) throw new Error('fromId is not defined in this graph: ' + fromId);
    var to = graph.getNode(toId);
    if (!to) throw new Error('toId is not defined in this graph: ' + toId);

    pool.reset();

    // I must also apologize for somewhat cryptic names. The NBA* is bi-directional
    // search algorithm, which means it runs two searches in parallel. One is called
    // forward search and it runs from source node to target, while the other one
    // (backward search) runs from target to source.

    // Everywhere where you see `1` it means it's for the forward search. `2` is for 
    // backward search.

    // For oriented graph path finding, we need to reverse the graph, so that
    // backward search visits correct link. Obviously we don't want to duplicate
    // the graph, instead we always traverse the graph as non-oriented, and filter
    // edges in `visitN1Oriented/visitN2Oritented`
    var forwardVisitor = oriented ? visitN1Oriented : visitN1;
    var reverseVisitor = oriented ? visitN2Oriented : visitN2;

    // Maps nodeId to NBASearchState.
    var nodeState = new Map();

    // These two heaps store nodes by their underestimated values.
    var open1Set = new NodeHeap({
      compare: defaultSettings.compareF1Score,
      setNodeId: defaultSettings.setH1
    });
    var open2Set = new NodeHeap({
      compare: defaultSettings.compareF2Score,
      setNodeId: defaultSettings.setH2
    });

    // This is where both searches will meet.
    var minNode;

    // The smallest path length seen so far is stored here:
    var lMin = Number.POSITIVE_INFINITY;

    // We start by putting start/end nodes to the corresponding heaps
    // If variable names like `f1`, `g1` are too confusing, please refer
    // to makeNBASearchStatePool.js file, which has detailed description.
    var startNode = pool.createNewState(from);
    nodeState.set(fromId, startNode); 
    startNode.g1 = 0;
    var f1 = heuristic(from, to);
    startNode.f1 = f1;
    open1Set.push(startNode);

    var endNode = pool.createNewState(to);
    nodeState.set(toId, endNode);
    endNode.g2 = 0;
    var f2 = f1; // they should agree originally
    endNode.f2 = f2;
    open2Set.push(endNode)

    // the `cameFrom` variable is accessed by both searches, so that we can store parents.
    var cameFrom;

    // this is the main algorithm loop:
    while (open2Set.length && open1Set.length) {
      if (open1Set.length < open2Set.length) {
        forwardSearch();
      } else {
        reverseSearch();
      }

      if (quitFast && minNode) break;
    }

    var path = reconstructPath(minNode);
    return path; // the public API is over

    function forwardSearch() {
      cameFrom = open1Set.pop();
      if (cameFrom.closed) {
        return;
      }

      cameFrom.closed = true;

      if (cameFrom.f1 < lMin && (cameFrom.g1 + f2 - heuristic(from, cameFrom.node)) < lMin) {
        graph.forEachLinkedNode(cameFrom.node.id, forwardVisitor);
      }

      if (open1Set.length > 0) {
        // this will be used in reverse search
        f1 = open1Set.peek().f1;
      } 
    }

    function reverseSearch() {
      cameFrom = open2Set.pop();
      if (cameFrom.closed) {
        return;
      }
      cameFrom.closed = true;

      if (cameFrom.f2 < lMin && (cameFrom.g2 + f1 - heuristic(cameFrom.node, to)) < lMin) {
        graph.forEachLinkedNode(cameFrom.node.id, reverseVisitor);
      }

      if (open2Set.length > 0) {
        // this will be used in forward search
        f2 = open2Set.peek().f2;
      }
    }

    function visitN1(otherNode, link) {
      var otherSearchState = nodeState.get(otherNode.id);
      if (!otherSearchState) {
        otherSearchState = pool.createNewState(otherNode);
        nodeState.set(otherNode.id, otherSearchState);
      }

      if (otherSearchState.closed) return;

      var tentativeDistance = cameFrom.g1 + distance(cameFrom.node, otherNode, link);

      if (tentativeDistance < otherSearchState.g1) {
        otherSearchState.g1 = tentativeDistance;
        otherSearchState.f1 = tentativeDistance + heuristic(otherSearchState.node, to);
        otherSearchState.p1 = cameFrom;
        if (otherSearchState.h1 < 0) {
          open1Set.push(otherSearchState);
        } else {
          open1Set.updateItem(otherSearchState.h1);
        }
      }
      var potentialMin = otherSearchState.g1 + otherSearchState.g2;
      if (potentialMin < lMin) { 
        lMin = potentialMin;
        minNode = otherSearchState;
      }
    }

    function visitN2(otherNode, link) {
      var otherSearchState = nodeState.get(otherNode.id);
      if (!otherSearchState) {
        otherSearchState = pool.createNewState(otherNode);
        nodeState.set(otherNode.id, otherSearchState);
      }

      if (otherSearchState.closed) return;

      var tentativeDistance = cameFrom.g2 + distance(cameFrom.node, otherNode, link);

      if (tentativeDistance < otherSearchState.g2) {
        otherSearchState.g2 = tentativeDistance;
        otherSearchState.f2 = tentativeDistance + heuristic(from, otherSearchState.node);
        otherSearchState.p2 = cameFrom;
        if (otherSearchState.h2 < 0) {
          open2Set.push(otherSearchState);
        } else {
          open2Set.updateItem(otherSearchState.h2);
        }
      }
      var potentialMin = otherSearchState.g1 + otherSearchState.g2;
      if (potentialMin < lMin) {
        lMin = potentialMin;
        minNode = otherSearchState;
      }
    }

    function visitN2Oriented(otherNode, link) {
      // we are going backwards, graph needs to be reversed. 
      if (link.toId === cameFrom.node.id) return visitN2(otherNode, link);
    }
    function visitN1Oriented(otherNode, link) {
      // this is forward direction, so we should be coming FROM:
      if (link.fromId === cameFrom.node.id) return visitN1(otherNode, link);
    }
  }
}

function reconstructPath(searchState) {
  if (!searchState) return NO_PATH;

  var path = [searchState.node];
  var parent = searchState.p1;

  while (parent) {
    path.push(parent.node);
    parent = parent.p1;
  }

  var child = searchState.p2;

  while (child) {
    path.unshift(child.node);
    child = child.p2;
  }
  return path;
}


/***/ }),

/***/ "./node_modules/ngraph.path/a-star/nba/makeNBASearchStatePool.js":
/*!***********************************************************************!*\
  !*** ./node_modules/ngraph.path/a-star/nba/makeNBASearchStatePool.js ***!
  \***********************************************************************/
/***/ ((module) => {

module.exports = makeNBASearchStatePool;

/**
 * Creates new instance of NBASearchState. The instance stores information
 * about search state, and is used by NBA* algorithm.
 *
 * @param {Object} node - original graph node
 */
function NBASearchState(node) {
  /**
   * Original graph node.
   */
  this.node = node;

  /**
   * Parent of this node in forward search
   */
  this.p1 = null;

  /**
   * Parent of this node in reverse search
   */
  this.p2 = null;

  /**
   * If this is set to true, then the node was already processed
   * and we should not touch it anymore.
   */
  this.closed = false;

  /**
   * Actual distance from this node to its parent in forward search
   */
  this.g1 = Number.POSITIVE_INFINITY;

  /**
   * Actual distance from this node to its parent in reverse search
   */
  this.g2 = Number.POSITIVE_INFINITY;


  /**
   * Underestimated distance from this node to the path-finding source.
   */
  this.f1 = Number.POSITIVE_INFINITY;

  /**
   * Underestimated distance from this node to the path-finding target.
   */
  this.f2 = Number.POSITIVE_INFINITY;

  // used to reconstruct heap when fScore is updated. TODO: do I need them both?

  /**
   * Index of this node in the forward heap.
   */
  this.h1 = -1;

  /**
   * Index of this node in the reverse heap.
   */
  this.h2 = -1;
}

/**
 * As path-finding is memory-intensive process, we want to reduce pressure on
 * garbage collector. This class helps us to recycle path-finding nodes and significantly
 * reduces the search time (~20% faster than without it).
 */
function makeNBASearchStatePool() {
  var currentInCache = 0;
  var nodeCache = [];

  return {
    /**
     * Creates a new NBASearchState instance
     */
    createNewState: createNewState,

    /**
     * Marks all created instances available for recycling.
     */
    reset: reset
  };

  function reset() {
    currentInCache = 0;
  }

  function createNewState(node) {
    var cached = nodeCache[currentInCache];
    if (cached) {
      // TODO: This almost duplicates constructor code. Not sure if
      // it would impact performance if I move this code into a function
      cached.node = node;

      // How we came to this node?
      cached.p1 = null;
      cached.p2 = null;

      cached.closed = false;

      cached.g1 = Number.POSITIVE_INFINITY;
      cached.g2 = Number.POSITIVE_INFINITY;
      cached.f1 = Number.POSITIVE_INFINITY;
      cached.f2 = Number.POSITIVE_INFINITY;

      // used to reconstruct heap when fScore is updated.
      cached.h1 = -1;
      cached.h2 = -1;
    } else {
      cached = new NBASearchState(node);
      nodeCache[currentInCache] = cached;
    }
    currentInCache++;
    return cached;
  }
}


/***/ }),

/***/ "./node_modules/ngraph.path/index.js":
/*!*******************************************!*\
  !*** ./node_modules/ngraph.path/index.js ***!
  \*******************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

module.exports = {
  aStar: __webpack_require__(/*! ./a-star/a-star.js */ "./node_modules/ngraph.path/a-star/a-star.js"),
  aGreedy: __webpack_require__(/*! ./a-star/a-greedy-star */ "./node_modules/ngraph.path/a-star/a-greedy-star.js"),
  nba: __webpack_require__(/*! ./a-star/nba/index.js */ "./node_modules/ngraph.path/a-star/nba/index.js"),
}


/***/ }),

/***/ "./src/ExpressionTestPageLoader.ts":
/*!*****************************************!*\
  !*** ./src/ExpressionTestPageLoader.ts ***!
  \*****************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.loadExpressionsTestPage = void 0;
const ConvenientExpressions_1 = __webpack_require__(/*! ./mathlib/ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Derivative_1 = __webpack_require__(/*! ./mathlib/expressions/Derivative */ "./src/mathlib/expressions/Derivative.ts");
const Exponent_1 = __webpack_require__(/*! ./mathlib/expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Fraction_1 = __webpack_require__(/*! ./mathlib/expressions/Fraction */ "./src/mathlib/expressions/Fraction.ts");
const Integral_1 = __webpack_require__(/*! ./mathlib/expressions/Integral */ "./src/mathlib/expressions/Integral.ts");
const EditableMathView_1 = __webpack_require__(/*! ./mathlib/uielements/EditableMathView */ "./src/mathlib/uielements/EditableMathView.ts");
/**
 * Called after the dom is loaded.
 * Populates the body element of the document
 * with the test expressions page
 */
function loadExpressionsTestPage() {
    const page = document.getElementsByTagName('body')[0];
    function p(content) {
        const e = document.createElement('p');
        e.innerText = content;
        page.append(e);
    }
    function view(exp) {
        const e = new EditableMathView_1.EditableMathView();
        e.value = exp;
        page.append(e);
    }
    p("The sum of a, a, and a");
    view((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.a, ConvenientExpressions_1.a, ConvenientExpressions_1.a));
    p("Integral of a over b with respect to c");
    view(Integral_1.Integral.of(Fraction_1.Fraction.of(ConvenientExpressions_1.a, ConvenientExpressions_1.b), ConvenientExpressions_1.c));
    p("Integral of (a over a) over b with respect to c");
    view(Integral_1.Integral.of(Fraction_1.Fraction.of(Fraction_1.Fraction.of(ConvenientExpressions_1.a, ConvenientExpressions_1.a), ConvenientExpressions_1.b), ConvenientExpressions_1.c));
    p("Integral of ((a over a) over a) over b with respect to c");
    view(Integral_1.Integral.of(Fraction_1.Fraction.of(Fraction_1.Fraction.of(Fraction_1.Fraction.of(ConvenientExpressions_1.a, ConvenientExpressions_1.a), ConvenientExpressions_1.a), ConvenientExpressions_1.b), ConvenientExpressions_1.c));
    p("Integral of (((a over a) over a) over a) over b with respect to c");
    view(Integral_1.Integral.of(Fraction_1.Fraction.of(Fraction_1.Fraction.of(Fraction_1.Fraction.of(Fraction_1.Fraction.of(ConvenientExpressions_1.a, ConvenientExpressions_1.a), ConvenientExpressions_1.a), ConvenientExpressions_1.a), ConvenientExpressions_1.b), ConvenientExpressions_1.c));
    p("Integral of ((((a over a) over a) over a) over a) over b with respect to c");
    view(Integral_1.Integral.of(Fraction_1.Fraction.of(Fraction_1.Fraction.of(Fraction_1.Fraction.of(Fraction_1.Fraction.of(Fraction_1.Fraction.of(ConvenientExpressions_1.a, ConvenientExpressions_1.a), ConvenientExpressions_1.a), ConvenientExpressions_1.a), ConvenientExpressions_1.a), ConvenientExpressions_1.b), ConvenientExpressions_1.c));
    p("");
    view((0, ConvenientExpressions_1.int)(Fraction_1.Fraction.of((0, ConvenientExpressions_1.sum)((0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.b), Exponent_1.Exponent.of((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.x, ConvenientExpressions_1.a), Fraction_1.Fraction.of((0, ConvenientExpressions_1.num)(1), (0, ConvenientExpressions_1.num)(2)))), (0, ConvenientExpressions_1.product)((0, ConvenientExpressions_1.num)(2), ConvenientExpressions_1.a)), ConvenientExpressions_1.x));
    p("Product of x and y");
    view((0, ConvenientExpressions_1.product)(ConvenientExpressions_1.x, ConvenientExpressions_1.y));
    p("Product of (x-1), -1 and y");
    view((0, ConvenientExpressions_1.product)((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.x, (0, ConvenientExpressions_1.negative)((0, ConvenientExpressions_1.num)(1))), (0, ConvenientExpressions_1.num)(-1), ConvenientExpressions_1.y));
    p("Negation of x (Reped as the propduct of -1 and x)");
    view((0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.x));
    p("Sum of x and -x");
    view((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.x, (0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.x)));
    p("Sum of -x and x");
    view((0, ConvenientExpressions_1.sum)((0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.x), ConvenientExpressions_1.x));
    p("Derivative of the square of x with respect to x");
    view(Derivative_1.Derivative.of(Exponent_1.Exponent.of(ConvenientExpressions_1.x, (0, ConvenientExpressions_1.num)(2)), ConvenientExpressions_1.x));
    p("Derivative ((x^2) - 2) with respect to x");
    view(Derivative_1.Derivative.of(Exponent_1.Exponent.of((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.x, (0, ConvenientExpressions_1.num)(-2)), (0, ConvenientExpressions_1.num)(2)), ConvenientExpressions_1.x));
    p("");
    view((0, ConvenientExpressions_1.num)(1));
    p("");
    view((0, ConvenientExpressions_1.num)(1));
    p("");
    view((0, ConvenientExpressions_1.num)(1));
    p("");
    view((0, ConvenientExpressions_1.num)(1));
}
exports.loadExpressionsTestPage = loadExpressionsTestPage;


/***/ }),

/***/ "./src/InputParseTestPage.ts":
/*!***********************************!*\
  !*** ./src/InputParseTestPage.ts ***!
  \***********************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.loadInputParseTestPage = void 0;
const ConvenientExpressions_1 = __webpack_require__(/*! ./mathlib/ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Exponent_1 = __webpack_require__(/*! ./mathlib/expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Logarithm_1 = __webpack_require__(/*! ./mathlib/expressions/Logarithm */ "./src/mathlib/expressions/Logarithm.ts");
const EditableMathView_1 = __webpack_require__(/*! ./mathlib/uielements/EditableMathView */ "./src/mathlib/uielements/EditableMathView.ts");
const AntlrMathParser_1 = __webpack_require__(/*! ./mathlib/userinput/AntlrMathParser */ "./src/mathlib/userinput/AntlrMathParser.ts");
/**
 * Called after DOM is loaded.
 * Substitutes the body element in the document
 * with the primary integrator view.
 */
function loadInputParseTestPage() {
    const page = document.getElementsByTagName('body')[0];
    page.style.padding = "8ch";
    function p(content) {
        const e = document.createElement('p');
        e.innerText = content;
        return e;
    }
    function view(exp) {
        const e = new EditableMathView_1.EditableMathView();
        e.value = exp;
        return e;
    }
    /**
     * Print the parsed expression to the page.
     * @param input User input string to parse.
     * @param explanation
     */
    function expression(input, explanation = null) {
        page.append(p("Input:       " + input));
        if (explanation != null)
            page.append(p(explanation));
        page.append(view((0, AntlrMathParser_1.parseExpression)(input)));
    }
    /**
     * Takes an internal expression, converts it
     * to a string, then parses that string into
     * an expression.
     * @param input
     */
    function twoWay(input) {
        const table = document.createElement('table');
        table.style.border = "1px solid black";
        table.style.width = '70%';
        const row = document.createElement('tr');
        table.appendChild(row);
        const data1 = document.createElement('td');
        const data2 = document.createElement('td');
        const data3 = document.createElement('td');
        row.appendChild(data1);
        row.appendChild(data2);
        row.appendChild(data3);
        data1.style.border = "1px solid black";
        data2.style.border = "1px solid black";
        data3.style.border = "1px solid black";
        data1.appendChild(view(input));
        const text = p(input.toUnambigiousString());
        text.style.display = "block";
        text.style.textAlign = "center";
        data2.appendChild(text);
        const parseResult = (0, AntlrMathParser_1.parseExpression)(input.toUnambigiousString());
        data3.appendChild(view(parseResult));
        page.append(table);
        // Conditional formatting
        if (input === parseResult) {
            data3.style.backgroundColor = "lightgreen";
        }
        else {
            data3.style.backgroundColor = "red";
        }
    }
    // Expression strings to test
    expression("a^b+c", "The +c shouldn't be in the exponent");
    expression("a+b^c");
    expression("(a+b)^c");
    expression("-a-b+c");
    expression("-a+-b+c");
    expression("a+b+c");
    expression("-(a+b)");
    expression("-a(a+b)");
    expression("a+(b+c)");
    expression("a-b-c");
    expression("a*b+c");
    expression("a/b+c");
    expression("a/b/c");
    expression("abx-d");
    expression("-abx-d");
    expression("-a-bx-d");
    expression("abcd");
    expression("a*b*c*d");
    expression("ab*cd");
    expression("int4x+2");
    expression("int(4x+2)");
    expression("logx");
    expression("log(x)");
    twoWay((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.x, ConvenientExpressions_1.y, ConvenientExpressions_1.a, ConvenientExpressions_1.b, ConvenientExpressions_1.c));
    twoWay((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.x, ConvenientExpressions_1.y, (0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.a), ConvenientExpressions_1.b, ConvenientExpressions_1.c));
    twoWay((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.x, ConvenientExpressions_1.y, (0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.a), (0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.b), ConvenientExpressions_1.c));
    twoWay((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.x, ConvenientExpressions_1.y, (0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.a), ConvenientExpressions_1.b, (0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.c)));
    twoWay((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.a, Exponent_1.Exponent.of(ConvenientExpressions_1.b, ConvenientExpressions_1.c)));
    twoWay(Exponent_1.Exponent.of((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.a, ConvenientExpressions_1.b), ConvenientExpressions_1.c));
    twoWay((0, ConvenientExpressions_1.sum)((0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.a), (0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.b), ConvenientExpressions_1.c));
    twoWay((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.a, ConvenientExpressions_1.b, ConvenientExpressions_1.c));
    twoWay((0, ConvenientExpressions_1.negative)((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.a, ConvenientExpressions_1.b)));
    twoWay((0, ConvenientExpressions_1.product)((0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.a), (0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.a, ConvenientExpressions_1.b)));
    twoWay((0, ConvenientExpressions_1.negative)((0, ConvenientExpressions_1.product)(ConvenientExpressions_1.a, (0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.a, ConvenientExpressions_1.b))));
    twoWay((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.a, (0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.b, ConvenientExpressions_1.c)));
    twoWay((0, ConvenientExpressions_1.sum)(ConvenientExpressions_1.a, (0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.b), (0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.c)));
    twoWay((0, ConvenientExpressions_1.sum)((0, ConvenientExpressions_1.product)(ConvenientExpressions_1.a, ConvenientExpressions_1.b), ConvenientExpressions_1.c));
    twoWay((0, ConvenientExpressions_1.sum)((0, ConvenientExpressions_1.fraction)(ConvenientExpressions_1.a, ConvenientExpressions_1.b), ConvenientExpressions_1.c));
    twoWay((0, ConvenientExpressions_1.fraction)((0, ConvenientExpressions_1.fraction)(ConvenientExpressions_1.a, ConvenientExpressions_1.b), ConvenientExpressions_1.c));
    twoWay((0, ConvenientExpressions_1.sum)((0, ConvenientExpressions_1.product)(ConvenientExpressions_1.a, ConvenientExpressions_1.b, ConvenientExpressions_1.x), ConvenientExpressions_1.d));
    twoWay((0, ConvenientExpressions_1.sum)((0, ConvenientExpressions_1.negative)((0, ConvenientExpressions_1.product)(ConvenientExpressions_1.a, ConvenientExpressions_1.b, ConvenientExpressions_1.x)), (0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.d)));
    twoWay((0, ConvenientExpressions_1.sum)((0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.a), (0, ConvenientExpressions_1.negative)((0, ConvenientExpressions_1.product)(ConvenientExpressions_1.b, ConvenientExpressions_1.x)), (0, ConvenientExpressions_1.negative)(ConvenientExpressions_1.d)));
    twoWay((0, ConvenientExpressions_1.product)(ConvenientExpressions_1.a, ConvenientExpressions_1.b, ConvenientExpressions_1.c, ConvenientExpressions_1.d));
    // twoWay("ab*cd")
    // twoWay("int4x+2")
    // twoWay("int(4x+2)")
    twoWay(Logarithm_1.Logarithm.of(ConvenientExpressions_1.x, (0, ConvenientExpressions_1.num)(10)));
}
exports.loadInputParseTestPage = loadInputParseTestPage;


/***/ }),

/***/ "./src/PrimaryPageLoader.ts":
/*!**********************************!*\
  !*** ./src/PrimaryPageLoader.ts ***!
  \**********************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.loadPrimaryPage = void 0;
const ConvenientExpressions_1 = __webpack_require__(/*! ./mathlib/ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const WebGraphView_1 = __webpack_require__(/*! ./mathlib/uielements/WebGraphView */ "./src/mathlib/uielements/WebGraphView.ts");
const Graph_1 = __webpack_require__(/*! ./mathlib/Graph */ "./src/mathlib/Graph.ts");
const Deriver_1 = __webpack_require__(/*! ./mathlib/derivations/Deriver */ "./src/mathlib/derivations/Deriver.ts");
const Expression_1 = __webpack_require__(/*! ./mathlib/expressions/Expression */ "./src/mathlib/expressions/Expression.ts");
const RelationalDerivationRule_1 = __webpack_require__(/*! ./mathlib/derivations/RelationalDerivationRule */ "./src/mathlib/derivations/RelationalDerivationRule.ts");
const SubtractFromBothSides_1 = __webpack_require__(/*! ./mathlib/derivations/algebra/SubtractFromBothSides */ "./src/mathlib/derivations/algebra/SubtractFromBothSides.ts");
const DivideOnBothSides_1 = __webpack_require__(/*! ./mathlib/derivations/algebra/DivideOnBothSides */ "./src/mathlib/derivations/algebra/DivideOnBothSides.ts");
const Variable_1 = __webpack_require__(/*! ./mathlib/expressions/Variable */ "./src/mathlib/expressions/Variable.ts");
const Logarithm_1 = __webpack_require__(/*! ./mathlib/expressions/Logarithm */ "./src/mathlib/expressions/Logarithm.ts");
RelationalDerivationRule_1.RelationalDerivationRule.rules.add(new SubtractFromBothSides_1.SubtractFromBothSides());
RelationalDerivationRule_1.RelationalDerivationRule.rules.add(new DivideOnBothSides_1.DivideOnBothSides());
/**
 * Called after DOM is loaded.
 * Substitutes the body element in the document
 * with the primary integrator view.
 */
function loadPrimaryPage() {
    //const root = Derivative.of(sum(a, a, product(num(2), b)), a)
    //const root = Derivative.of(product(num(3), Exponent.of(x, num(2)), Exponent.of(x, num(3))), x)
    //const root = product(Exponent.of(x, num(3)), Exponent.of(x, num(4)), x, x)
    //const root = Derivative.of(Fraction.of(Exponent.of(x, num(2)), x), x)
    //const root = Fraction.of(product(num(2), x, Exponent.of(x, a), a), product(num(2), a, a, x))
    const root = Logarithm_1.Logarithm.of((0, ConvenientExpressions_1.num)(1), ConvenientExpressions_1.a);
    const graph = new Graph_1.Graph().addNode(root);
    const deriver = new Deriver_1.Deriver(graph);
    deriver.expand();
    //console.log("Result: " + graph)
    const input = document.getElementById("input");
    input.addEventListener("keyup", () => {
        //parse((input! as HTMLTextAreaElement).value)
    });
    const out = document.getElementById("outputbox");
    const config = {
        showArguments: false,
        drawEdgeLines: true,
        debugCornerEnabled: true,
    };
    const graphView = new WebGraphView_1.WebGraphView(graph, new Set([root]), config);
    graphView.setNodeColoringScheme(n => {
        if (n instanceof Expression_1.Expression) {
            if (!deriver.isSimplified(n))
                return "lightgray";
            else if (n instanceof Variable_1.Variable)
                return "orange";
            else
                return "lightblue";
        }
        return "black";
    });
    graphView.setAttribute("id", "web-graphview");
    out.appendChild(graphView);
}
exports.loadPrimaryPage = loadPrimaryPage;


/***/ }),

/***/ "./src/SolverPageLoader.ts":
/*!*********************************!*\
  !*** ./src/SolverPageLoader.ts ***!
  \*********************************/
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.loadSolverPage = void 0;
const Deriver_1 = __webpack_require__(/*! ./mathlib/derivations/Deriver */ "./src/mathlib/derivations/Deriver.ts");
const Graph_1 = __webpack_require__(/*! ./mathlib/Graph */ "./src/mathlib/Graph.ts");
const ngraph_path_1 = __importDefault(__webpack_require__(/*! ngraph.path */ "./node_modules/ngraph.path/index.js"));
const ngraph_graph_1 = __importDefault(__webpack_require__(/*! ngraph.graph */ "./node_modules/ngraph.graph/index.js"));
const Expression_1 = __webpack_require__(/*! ./mathlib/expressions/Expression */ "./src/mathlib/expressions/Expression.ts");
const Argument_1 = __webpack_require__(/*! ./mathlib/Argument */ "./src/mathlib/Argument.ts");
const ArgumentNodeView_1 = __webpack_require__(/*! ./mathlib/uielements/ArgumentNodeView */ "./src/mathlib/uielements/ArgumentNodeView.ts");
const ExpressionNodeView_1 = __webpack_require__(/*! ./mathlib/uielements/ExpressionNodeView */ "./src/mathlib/uielements/ExpressionNodeView.ts");
const GraphMinipulator_1 = __webpack_require__(/*! ./mathlib/GraphMinipulator */ "./src/mathlib/GraphMinipulator.ts");
const AntlrMathParser_1 = __webpack_require__(/*! ./mathlib/userinput/AntlrMathParser */ "./src/mathlib/userinput/AntlrMathParser.ts");
function loadSolverPage() {
    const problemView = document.getElementById('problem');
    const solutionView = document.getElementById('solution');
    const stepListView = document.getElementById('steps');
    problemView.addEventListener("keyup", () => {
        // Parse input
        const exp = (0, AntlrMathParser_1.parseExpression)(problemView.value);
        const steps = getSolution(exp);
        solutionView.value = steps[steps.length - 1];
        steps.forEach(step => {
            let view;
            if (step instanceof Argument_1.Argument) {
                view = new ArgumentNodeView_1.ArgumentNodeView(step, view => { });
            }
            else if (step instanceof Expression_1.Expression) {
                view = new ExpressionNodeView_1.ExpressionNodeView(step, view => { });
            }
            else
                throw new Error("Not implemented");
            stepListView.appendChild(view);
        });
    });
}
exports.loadSolverPage = loadSolverPage;
/**
 * Simplifies the given expression returning an array
 * of steps ending in the answer.
 * The last node will be an expression.
 */
function getSolution(problem) {
    const graph = new Graph_1.Graph().addNode(problem);
    const deriver = new Deriver_1.Deriver(graph);
    deriver.expand();
    let simplified = null;
    for (const node of graph.getNodes()) {
        if (node instanceof Expression_1.Expression)
            if (deriver.isSimplified(node))
                simplified = node;
    }
    // Copy the resulting graph into a library implementation of graph
    const libraryGraph = (0, ngraph_graph_1.default)();
    graph.getNodes().forEach(n => libraryGraph.addNode(n.id, n));
    // I assume that library graph isn't directed
    for (const edge of GraphMinipulator_1.GraphMinipulator.dropSymmetric(graph.getEdges())) {
        libraryGraph.addLink(edge.n.id, edge.n1.id);
        // if (edge.n instanceof Expression && edge.n1 instanceof Expression)
        //     console.log(`edge ${edge.n} AND ${edge.n1}`)
    }
    // Do path finding operation on it
    const pathFinder = ngraph_path_1.default.nba(libraryGraph);
    const resultPath = pathFinder.find(problem.id, simplified.id).reverse();
    return resultPath.map(node => {
        if (node.data instanceof Argument_1.Argument)
            return node.data;
        else if (node.data instanceof Expression_1.Expression)
            return node.data;
        else
            throw new Error("Not implemented");
    });
}


/***/ }),

/***/ "./src/mathlib/Argument.ts":
/*!*********************************!*\
  !*** ./src/mathlib/Argument.ts ***!
  \*********************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Argument = void 0;
const MathGraphNode_1 = __webpack_require__(/*! ./MathGraphNode */ "./src/mathlib/MathGraphNode.ts");
const assert_1 = __webpack_require__(/*! ./util/assert */ "./src/mathlib/util/assert.ts");
/**
 * Connects one or more nodes (grounds) to one or more nodes (claims).
 * Contains an explanation/argument for the connection.
 */
class Argument extends MathGraphNode_1.MathGraphNode {
    constructor(grounds, claim, argument) {
        super();
        this.grounds = grounds;
        Object.freeze(this.grounds);
        this.claim = claim;
        this.argument = argument;
        this.repOk();
    }
    expressionEdge = true;
    get relationship() {
        return this.claim.r;
    }
    toString() {
        return "Argument " + this.claim.r;
    }
    /**
     * Two out math graph nodes that are related by this Arugment.
     */
    claim;
    /**
     * The explanation that connects the argument's grounds to
     * it's claimed relationship between the two out nodes.
     *
     */
    argument;
    /**
     * Nodes that have an edge pointing to this argument.
     */
    grounds;
    repOk() {
        (0, assert_1.assert)(this.grounds != null);
        for (const ground of this.grounds) {
            (0, assert_1.assert)(ground != null && ground != undefined);
        }
        (0, assert_1.assert)(this.claim.n != null && this.claim.n != undefined);
        (0, assert_1.assert)(this.claim.n1 != null && this.claim.n1 != undefined);
        (0, assert_1.assert)(this.claim.r != undefined && this.claim.r != null);
    }
}
exports.Argument = Argument;


/***/ }),

/***/ "./src/mathlib/ConvenientExpressions.ts":
/*!**********************************************!*\
  !*** ./src/mathlib/ConvenientExpressions.ts ***!
  \**********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.y = exports.x = exports.f = exports.e = exports.d = exports.c = exports.b = exports.a = exports.productAndNotTimesOne = exports.productOrNot = exports.equivalenceArgument = exports.int = exports.v = exports.num = exports.negative = exports.product = exports.removeNew = exports.remove = exports.orderedProduct = exports.sumOrNot = exports.sumIntuitive = exports.sumEvalIntegerTerms = exports.orderedSum = exports.sum = exports.fraction = void 0;
const Integer_1 = __webpack_require__(/*! ./expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Fraction_1 = __webpack_require__(/*! ./expressions/Fraction */ "./src/mathlib/expressions/Fraction.ts");
const Integral_1 = __webpack_require__(/*! ./expressions/Integral */ "./src/mathlib/expressions/Integral.ts");
const Product_1 = __webpack_require__(/*! ./expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Sum_1 = __webpack_require__(/*! ./expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const Variable_1 = __webpack_require__(/*! ./expressions/Variable */ "./src/mathlib/expressions/Variable.ts");
const Argument_1 = __webpack_require__(/*! ./Argument */ "./src/mathlib/Argument.ts");
const Relationship_1 = __webpack_require__(/*! ./Relationship */ "./src/mathlib/Relationship.ts");
const assert_1 = __webpack_require__(/*! ./util/assert */ "./src/mathlib/util/assert.ts");
function fraction(num, den) {
    return Fraction_1.Fraction.of(num, den);
}
exports.fraction = fraction;
/**
 * A convenience method for Sum.of()
 */
function sum(...terms) {
    return Sum_1.Sum.of(terms);
}
exports.sum = sum;
/**
 * Gets the correctly ordered sum of the given sum.
 * 1 + a = a + 1
 * Follows the spec given in the Sum.ts file.
 * @param sum
 * @returns
 */
function orderedSum(sum) {
    const ordered = (0, Sum_1.orderTerms)(...sum.terms);
    return Sum_1.Sum.of(ordered);
}
exports.orderedSum = orderedSum;
/**
 * Returns the sum of the given terms, evaluating any integer terms.
 * Puts final constant integer as the last term.
 * If the result is a sum, it will not have the integer 0 as a term.
 * If all given terms sum to zero, the integer zero will be returned.
 * @param terms
 */
function sumEvalIntegerTerms(...terms) {
    const integers = terms.filter(e => e instanceof Integer_1.Integer).length;
    if (integers < 2)
        return sum(...terms);
    const nonIntTerms = terms.filter(e => !(e instanceof Integer_1.Integer));
    const intTerm = terms.filter(e => e instanceof Integer_1.Integer)
        .map(e => e)
        .reduce((a, b) => num(a.value + b.value));
    if (intTerm.value == 0) {
        if (nonIntTerms.length > 1) {
            return sum(...nonIntTerms);
        }
        else if (nonIntTerms.length == 1) {
            return nonIntTerms[0];
        }
        else {
            return intTerm;
        }
    }
    else {
        if (nonIntTerms.length == 0) {
            return intTerm;
        }
        else {
            return sum(...nonIntTerms, intTerm);
        }
    }
}
exports.sumEvalIntegerTerms = sumEvalIntegerTerms;
/**
 * Returns the sum of the given terms. Evaluates any
 * integer terms. Additionally cancels out any positive
 * negative terms.
 *
 * Simplifies
 *  x + a - a = x
 * x + ab - ab = x
 * x + 2ab - 2ab = x
 * a - a = 0
 *
 * Doesn't affect
 *  x + 2a - a
 * @param terms
 */
function sumIntuitive(...terms) {
    const intEval = sumEvalIntegerTerms(...terms);
    if (intEval.class != Sum_1.SumType)
        return intEval;
    terms = [...intEval.terms];
    // Find opposite pairs
    // They will take the form
    //      exp + -1 * exp
    // I assume here that the only way to notate
    // negativity is by multiplying by -1
    terms: for (const t of terms) {
        const otherTerms = [...terms];
        remove(otherTerms, t);
        for (const other of otherTerms) {
            if (other instanceof Product_1.Product) {
                if (other.isNegation && other.negation === t) {
                    remove(terms, other);
                    remove(terms, t);
                    continue terms;
                }
            }
        }
    }
    if (terms.length == 0)
        return Integer_1.Integer.of(0);
    else if (terms.length == 1)
        return terms[0];
    else
        return sum(...terms);
}
exports.sumIntuitive = sumIntuitive;
/**
 * Finds the sum of the given terms or if only 1
 * is given returns that term.
 * @param terms
 * @returns
 */
function sumOrNot(...terms) {
    if (terms.length == 1)
        return terms[0];
    else
        return sum(...terms);
}
exports.sumOrNot = sumOrNot;
/**
 * Produces a product from the given factors
 * where the factors are ordered according to convention.
 * @param factors At least 2
 */
function orderedProduct(...factors) {
    factors.sort(Product_1.factorOrder);
    return product(...factors);
}
exports.orderedProduct = orderedProduct;
/**
 * Removes the first instance of the given
 * element from the array. Really should be
 * part of the std library. Identifies object
 * with referencial equality.
 * @param array
 * @param element
 */
function remove(array, element) {
    for (let i = 0; i < array.length; i++) {
        if (array[i] === element) {
            array.splice(i, 1);
            return;
        }
    }
}
exports.remove = remove;
/**
 * Gets a new array without the first instance of the given
 * element. Really should be
 * part of the std library. Identifies object
 * with referencial equality.
 * @param array
 * @param element
 */
function removeNew(array, element) {
    const input = [...array];
    for (let i = 0; i < input.length; i++) {
        if (input[i] === element) {
            input.splice(i, 1);
            return input;
        }
    }
    throw new Error("Given array doesn't contain element " + element);
}
exports.removeNew = removeNew;
function product(...factors) {
    factors.forEach(f => (0, assert_1.assert)(f != null && f != undefined, "Making product with null or undefined factor"));
    return Product_1.Product.of(factors);
}
exports.product = product;
function negative(expression) {
    (0, assert_1.assert)(expression != undefined, "Taking negative of undefined expression");
    if (expression instanceof Integer_1.Integer)
        return Integer_1.Integer.of(-expression.value);
    else
        return Product_1.Product.of([Integer_1.Integer.of(-1), expression]);
}
exports.negative = negative;
function num(val) {
    return Integer_1.Integer.of(val);
}
exports.num = num;
function v(symbol) {
    return Variable_1.Variable.of(symbol);
}
exports.v = v;
function int(integrand, respectTo) {
    return Integral_1.Integral.of(integrand, respectTo);
}
exports.int = int;
function equivalenceArgument(first, second, explanation) {
    return new Argument_1.Argument(setOf(first), {
        n: first,
        r: Relationship_1.Relationship.Equal,
        n1: second,
    }, explanation);
}
exports.equivalenceArgument = equivalenceArgument;
/**
 *
 * @returns The product of the given factors, or the only factor given
 * if only one given. Throws if no expressions are given.
 */
function productOrNot(...expressions) {
    (0, assert_1.assert)(expressions.length > 0);
    if (expressions.length == 1)
        return expressions[0];
    return product(...expressions);
}
exports.productOrNot = productOrNot;
/**
 * @returns The product of the given terms exlcuding the first if
 *          it's one. If the resulting terms list is only one term,
 *          returns the only term.
 */
function productAndNotTimesOne(...expressions) {
    if (expressions[0] instanceof Integer_1.Integer && expressions[0].value == 1) {
        expressions.shift();
        return productOrNot(...expressions);
    }
    return productOrNot(...expressions);
}
exports.productAndNotTimesOne = productAndNotTimesOne;
function setOf(...expressions) {
    const out = new Set();
    expressions.forEach(e => out.add(e));
    return out;
}
exports.a = v('a');
exports.b = v('b');
exports.c = v('c');
exports.d = v('d');
exports.e = v('e');
exports.f = v('f');
exports.x = v('x');
exports.y = v('y');


/***/ }),

/***/ "./src/mathlib/Graph.ts":
/*!******************************!*\
  !*** ./src/mathlib/Graph.ts ***!
  \******************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.GivenEdge = exports.ArgumentEdge = exports.Graph = void 0;
const Argument_1 = __webpack_require__(/*! ./Argument */ "./src/mathlib/Argument.ts");
const assert_1 = __webpack_require__(/*! ./util/assert */ "./src/mathlib/util/assert.ts");
/**
 * Class representing a graph of expressions and statements
 * including everything we know about a problem.
 * Connects GraphNodes via Inferences for edges.
 *
 * It's a digraph. TODO: It may also need to be a multigraph...
 */
class Graph {
    constructor() {
        this.nodes = new Set();
        this.connections = new Map();
        this.edges = new Map();
        this.repOk();
    }
    /**
     * Adds an expression to the problem.
     * @param node
     * @returns the same graph for chaining.
     */
    addNode(node) {
        this.nodes.add(node);
        if (node instanceof Argument_1.Argument) {
            this.addArgument(node);
        }
        this.repOk();
        return this;
    }
    /**
     * Add a relationship between two elements given by the user to the graph.
     * Should not be called to add derived truths bc this won't store an explanation.
     * Adds given nodes if they aren't already on the graph.
     * @param n
     * @param n1
     * @param r
     * @returns self for chaining
     */
    addRelationship(n, n1, r) {
        this.addNode(n);
        this.addNode(n1);
        // Defined both ways because the user is giving it
        this.internalAdd(n, n1, new GivenEdge(r));
        this.internalAdd(n1, n, new GivenEdge(r));
        this.repOk();
        return this;
    }
    /**
     * Adds a node representing an acumulation of facts
     * that leads to a conclusion.
     * @param a
     * @returns the same graph for chaining.
     */
    addArgument(a) {
        this.nodes.add(a);
        // Add the grounds
        for (const ground of a.grounds) {
            this.nodes.add(ground);
            this.internalAdd(ground, a, ArgumentEdge.To);
        }
        // Add the claim
        const claim = a.claim;
        this.addNode(claim.n);
        this.addNode(claim.n1);
        this.internalAdd(a, claim.n, ArgumentEdge.From);
        this.internalAdd(a, claim.n1, ArgumentEdge.From);
        this.internalAdd(claim.n, claim.n1, a);
        this.internalAdd(claim.n1, claim.n, a);
        this.repOk();
        return this;
    }
    /**
     * @returns the same graph for chaining.
     */
    addArguments(...a) {
        a.forEach(arg => this.addArgument(arg));
        return this;
    }
    /**
     * Get the neighbors of a node.
     * @param node
     * @param direction Nodes that are adjacent to this node, from this node, or either.
     * @returns Undefined if the node isn't in this graph. Otherwise, a set of connected nodes.
     *          If the node is in the graph but isn't connected to anything, returns empty set.
     */
    getNeighbors(node, direction) {
        if (!this.nodes.has(node))
            return undefined;
        if (direction == "out") {
            return new Set(this.connections.get(node));
        }
        let adjacentTo = new Set();
        for (const n of this.nodes) {
            if (this.connections.get(n)?.has(node))
                adjacentTo.add(n);
        }
        if (direction == "in")
            return adjacentTo;
        for (const n of this.connections.get(node) ?? [])
            adjacentTo.add(n);
        return adjacentTo;
    }
    /**
     * Determines the number of edges this node has.
     * @param node The node being consdered.
     * @param direction Count only the edges going towards this node, away from
     *          it, or both.
     * @returns >= 0, undefined if the given node isn't in the graph.
     */
    getDegree(node, direction) {
        if (!this.nodes.has(node))
            return undefined;
        if (direction == "out") {
            return this.connections.get(node)?.size ?? 0;
        }
        let degIn = 0;
        this.nodes.forEach(n => {
            if (this.connections.get(n) == undefined)
                return;
            if (this.connections.get(n).has(node))
                degIn++;
        });
        if (direction == "in")
            return degIn;
        return degIn + (this.connections.get(node)?.size ?? 0);
    }
    /**
     * @param n Node in the graph.
     * @param n1 In the graph.
     * @returns Undefined if either node isn't in the graph or they're not
     * connected.
     */
    getEdge(n, n1) {
        return this.edges.get(n)?.get(n1);
    }
    contains(node) {
        return this.nodes.has(node);
    }
    /**
     * @returns A new set containing all the nodes in the graph
     */
    getNodes() {
        return new Set(this.nodes);
    }
    getEdges() {
        const out = new Set();
        this.edges.forEach((map, first) => {
            map.forEach((edge, second) => {
                out.add({ n: first, n1: second, e: edge });
            });
        });
        return out;
    }
    numNodes() {
        return this.nodes.size;
    }
    /**
     * Adds all graph nodes and edges to this one.
     * @param graph
     * @returns the same graph for chaining.
     */
    addGraph(graph) {
        graph.nodes.forEach(node => {
            this.nodes.add(node);
        });
        graph.edges.forEach((map, node1) => {
            map.forEach((edge, node2) => {
                if (edge instanceof Argument_1.Argument)
                    this.addArgument(edge);
                else if (edge == "supports") {
                    this.internalAdd(node1, node2, ArgumentEdge.To);
                }
                else if (edge == "claims") {
                    this.internalAdd(node1, node2, ArgumentEdge.From);
                }
                else
                    throw new Error("Unknown Edge Type");
            });
        });
        this.repOk();
        return this;
    }
    toString() {
        let out = "Graph(V = {";
        for (const node of this.nodes) {
            out += node.toString() + ",";
        }
        out = out.substring(0, out.length - 1) + "}, E = {";
        this.connections.forEach((set, src) => {
            set.forEach(dest => {
                out += src.toString() + " -> " + dest.toString() + ", ";
            });
        });
        out += "} Edge Count: " + this.connections.size;
        return out;
    }
    internalAdd(n, n1, e) {
        if (this.connections.get(n) == null) {
            this.connections.set(n, new Set());
        }
        this.connections.get(n).add(n1);
        if (this.edges.get(n) == undefined) {
            this.edges.set(n, new Map());
        }
        this.edges.get(n).set(n1, e);
        this.repOk();
    }
    repOk() {
        this.nodes.forEach((value) => {
            (0, assert_1.assert)(value != null && value != undefined);
        });
        // All connections/edges have nodes
        this.connections.forEach((value, key) => {
            (0, assert_1.assert)(this.nodes.has(key));
            value.forEach(n => {
                (0, assert_1.assert)(this.nodes.has(n));
            });
        });
        this.edges.forEach((map, first) => {
            map.forEach((edge, second) => {
                (0, assert_1.assert)(this.nodes.has(first));
                (0, assert_1.assert)(this.nodes.has(second));
                (0, assert_1.assert)(this.connections.get(first).has(second));
            });
        });
    }
    nodes;
    // Quickly access all connections of a node
    connections;
    // Determine the type of connection between two nodes
    edges;
}
exports.Graph = Graph;
var ArgumentEdge;
(function (ArgumentEdge) {
    ArgumentEdge["To"] = "supports";
    ArgumentEdge["From"] = "claims";
})(ArgumentEdge || (exports.ArgumentEdge = ArgumentEdge = {}));
/**
 * Communicates a relationhip given by the user.
 */
class GivenEdge {
    constructor(r) {
        this.r = r;
    }
    r;
}
exports.GivenEdge = GivenEdge;


/***/ }),

/***/ "./src/mathlib/GraphMinipulator.ts":
/*!*****************************************!*\
  !*** ./src/mathlib/GraphMinipulator.ts ***!
  \*****************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.GraphMinipulator = void 0;
const assert_1 = __webpack_require__(/*! ./util/assert */ "./src/mathlib/util/assert.ts");
/**
 * Tool to do operations on graphs.
 */
class GraphMinipulator {
    /**
     * Find nodes of components of a graph where only edges for which
     * the callback function returns true are considered.
     * @param
     * @param isConnected
     */
    static getComponentNodes(input, isConnected) {
        const includedNodes = new Set();
        const components = new Set();
        for (const node of input.getNodes()) {
            if (includedNodes.has(node)) {
                continue;
            }
            const component = new Set();
            function getAllConnected(n) {
                includedNodes.add(n);
                if (component.has(n)) {
                    return;
                }
                component.add(n);
                for (const neighbor of input.getNeighbors(n, "both")) {
                    if (!isConnected(input.getEdge(n, neighbor)))
                        continue;
                    getAllConnected(neighbor);
                }
                return;
            }
            getAllConnected(node);
            component.add(node);
            components.add(component);
        }
        (0, assert_1.assert)(includedNodes.size == input.numNodes());
        // Assert components are pairwise disjoint of problems show up
        return components;
    }
    /**
     * Gets every edge in the graph.
     * @param input
     * @returns
     */
    static getRelations(input) {
        const out = [];
        for (const node of input.getNodes()) {
            for (const other of input.getNeighbors(node, "out")) {
                out.push({ first: node, second: other, e: input.getEdge(node, other) });
            }
        }
        return out;
    }
    /**
     * Parses the graph into sets of
     * nodes grouped by depth from a center node.
     * Assumes the graph is connected.
     * @param rootNodes Contains at least one node in the graph.
     * @param count Function that determines if any given node should be
     * included in the depth count. Defaults to counting all nodes. Nodes that
     * aren't included won't be in the returned value.
     * @returns Map from depth in graph to a set of nodes at that depth.
     *
     */
    static getLevels(input, rootNodes, count = () => true) {
        const roots = new Set(rootNodes);
        const depths = new Map();
        /**
         * Recursively maps out all nodes in the graph,
         * puttin them in the depths map.
         * @param node
         */
        function mapNode(node, depth = 0) {
            if (roots.has(node)) {
                depth = 0;
            }
            if (depth < (depths.get(node) ?? Number.MAX_VALUE)) {
                depths.set(node, depth);
            }
            const neighbors = [...input.getNeighbors(node, "both")];
            neighbors.filter(value => {
                // If we have found a shorter path to it or there was no found path to it
                return (depths.get(value) == undefined || depths.get(value) > depth) && value !== node;
            }).forEach(n => {
                mapNode(n, count(node) ? depth + 1 : depth);
            });
        }
        mapNode([...roots][0]);
        const out = new Map();
        depths.forEach((depth, node) => {
            if (!count(node))
                return;
            if (out.get(depth) == undefined) {
                out.set(depth, new Set());
            }
            out.get(depth).add(node);
        });
        return out;
    }
    /**
     * Determines if the given graph is connected, meaning that
     * it's possible to traverse between any two nodes on the graph.
     */
    static isConnected(input) {
        // Check every node has a degree of 1 or more or graph only has 1 or 0 elements
        return [...input.getNodes()].map(node => {
            return input.getDegree(node, "both") > 0;
        }).reduce((a, b) => a && b) || input.numNodes() < 2;
    }
    /**
     * Filters edges list returning a list where only one edge
     * from any edge loops is included.
     * For example if the input edges are a -> b and b -> a,
     * the result will only contain a -> b.
     * @param edges
     */
    static dropSymmetric(edges) {
        const out = [];
        function alreadyHas(edge) {
            for (const e of out)
                if (edge.n == e.n1 && edge.n1 == e.n)
                    return true;
            return false;
        }
        for (const edge of edges) {
            if (!alreadyHas(edge))
                out.push(edge);
        }
        return out;
    }
}
exports.GraphMinipulator = GraphMinipulator;


/***/ }),

/***/ "./src/mathlib/MathGraphNode.ts":
/*!**************************************!*\
  !*** ./src/mathlib/MathGraphNode.ts ***!
  \**************************************/
/***/ ((__unused_webpack_module, exports) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.MathGraphNode = void 0;
class MathGraphNode {
    constructor() {
        this.id = MathGraphNode.nextId;
        MathGraphNode.nextId++;
    }
    static nextId = 1;
    id;
}
exports.MathGraphNode = MathGraphNode;


/***/ }),

/***/ "./src/mathlib/Relationship.ts":
/*!*************************************!*\
  !*** ./src/mathlib/Relationship.ts ***!
  \*************************************/
/***/ ((__unused_webpack_module, exports) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Relationship = void 0;
/**
 * A way in which 2 expressions can be related.
 */
var Relationship;
(function (Relationship) {
    Relationship["Equal"] = "=";
})(Relationship || (exports.Relationship = Relationship = {}));


/***/ }),

/***/ "./src/mathlib/derivations/DerivationRules.ts":
/*!****************************************************!*\
  !*** ./src/mathlib/derivations/DerivationRules.ts ***!
  \****************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.simplificationOrder = void 0;
const BreakDerivativesOverAddition_1 = __webpack_require__(/*! ./calculus/BreakDerivativesOverAddition */ "./src/mathlib/derivations/calculus/BreakDerivativesOverAddition.ts");
const PowerRule_1 = __webpack_require__(/*! ./calculus/PowerRule */ "./src/mathlib/derivations/calculus/PowerRule.ts");
const ProductRule_1 = __webpack_require__(/*! ./calculus/ProductRule */ "./src/mathlib/derivations/calculus/ProductRule.ts");
const PullConstantsFromDerivatives_1 = __webpack_require__(/*! ./calculus/PullConstantsFromDerivatives */ "./src/mathlib/derivations/calculus/PullConstantsFromDerivatives.ts");
const QuotientRule_1 = __webpack_require__(/*! ./calculus/QuotientRule */ "./src/mathlib/derivations/calculus/QuotientRule.ts");
const USubstitution_1 = __webpack_require__(/*! ./calculus/USubstitution */ "./src/mathlib/derivations/calculus/USubstitution.ts");
const AdditiveIdentity_1 = __webpack_require__(/*! ./simplifications/AdditiveIdentity */ "./src/mathlib/derivations/simplifications/AdditiveIdentity.ts");
const AssociativePropertyOfProductsAndSums_1 = __webpack_require__(/*! ./simplifications/AssociativePropertyOfProductsAndSums */ "./src/mathlib/derivations/simplifications/AssociativePropertyOfProductsAndSums.ts");
const CancelNegatives_1 = __webpack_require__(/*! ./simplifications/CancelNegatives */ "./src/mathlib/derivations/simplifications/CancelNegatives.ts");
const CombineCommonFactorsMultiplication_1 = __webpack_require__(/*! ./simplifications/CombineCommonFactorsMultiplication */ "./src/mathlib/derivations/simplifications/CombineCommonFactorsMultiplication.ts");
const CombineCommonTermsAddition_1 = __webpack_require__(/*! ./simplifications/CombineCommonTermsAddition */ "./src/mathlib/derivations/simplifications/CombineCommonTermsAddition.ts");
const CombineIntegerFactors_1 = __webpack_require__(/*! ./simplifications/CombineIntegerFactors */ "./src/mathlib/derivations/simplifications/CombineIntegerFactors.ts");
const DivideFractions_1 = __webpack_require__(/*! ./simplifications/DivideFractions */ "./src/mathlib/derivations/simplifications/DivideFractions.ts");
const DivisionIdentity_1 = __webpack_require__(/*! ./simplifications/DivisionIdentity */ "./src/mathlib/derivations/simplifications/DivisionIdentity.ts");
const EvaluateSums_1 = __webpack_require__(/*! ./simplifications/EvaluateSums */ "./src/mathlib/derivations/simplifications/EvaluateSums.ts");
const ExponentialIdentity_1 = __webpack_require__(/*! ./simplifications/ExponentialIdentity */ "./src/mathlib/derivations/simplifications/ExponentialIdentity.ts");
const ExponentToZero_1 = __webpack_require__(/*! ./simplifications/ExponentToZero */ "./src/mathlib/derivations/simplifications/ExponentToZero.ts");
const LogOfOne_1 = __webpack_require__(/*! ./simplifications/LogOfOne */ "./src/mathlib/derivations/simplifications/LogOfOne.ts");
const MultiplicativeIdentity_1 = __webpack_require__(/*! ./simplifications/MultiplicativeIdentity */ "./src/mathlib/derivations/simplifications/MultiplicativeIdentity.ts");
const MultiplyExponentPowers_1 = __webpack_require__(/*! ./simplifications/MultiplyExponentPowers */ "./src/mathlib/derivations/simplifications/MultiplyExponentPowers.ts");
const OrderSums_1 = __webpack_require__(/*! ./simplifications/OrderSums */ "./src/mathlib/derivations/simplifications/OrderSums.ts");
const RemoveCommonFactorsOnTopAndBottomOfFraction_1 = __webpack_require__(/*! ./simplifications/RemoveCommonFactorsOnTopAndBottomOfFraction */ "./src/mathlib/derivations/simplifications/RemoveCommonFactorsOnTopAndBottomOfFraction.ts");
const SubtractExponentsOnFractions_1 = __webpack_require__(/*! ./simplifications/SubtractExponentsOnFractions */ "./src/mathlib/derivations/simplifications/SubtractExponentsOnFractions.ts");
const SumCoefficientsOfAddedTerms_1 = __webpack_require__(/*! ./simplifications/SumCoefficientsOfAddedTerms */ "./src/mathlib/derivations/simplifications/SumCoefficientsOfAddedTerms.ts");
/**
 * 1 input, 1 output
 */
const beautifyingRules = [
    new OrderSums_1.OrderSums(),
];
/**
 * 1 input, 1 output
 */
const evaluativeRules = [
    new EvaluateSums_1.EvaluateSums(),
    new CancelNegatives_1.CancelNegatives(),
    new CombineIntegerFactors_1.CombineIntegerFactors(),
];
const combinatoricRules = [
    new SumCoefficientsOfAddedTerms_1.SumCoefficientsOfAddedTerms(),
    new CombineCommonTermsAddition_1.CombineCommonTermsAddition(),
    new CombineCommonFactorsMultiplication_1.CombineCommonFactorsMultiplication(),
    new MultiplyExponentPowers_1.MultiplyExponentPowers(),
    new SubtractExponentsOnFractions_1.SubtractExponentsOnFractions(),
];
const remainingNoContextSimplificationRules = [
    new USubstitution_1.USubstitution(),
    new PowerRule_1.PowerRule(),
    new PullConstantsFromDerivatives_1.PullConstantsFromDerivatives(),
    new AssociativePropertyOfProductsAndSums_1.AssociativePropertyOfProductsAndSums(),
    new ProductRule_1.ProductRule(),
    new QuotientRule_1.QuotientRule(),
    new DivideFractions_1.DivideFractions(),
    new RemoveCommonFactorsOnTopAndBottomOfFraction_1.RemoveCommonFactorsFromTopAndBottomOfFraction(),
    new BreakDerivativesOverAddition_1.BreakDerivativesOverAddition(),
];
/**
 * A list of lists of simplification rules.
 * Earlier lists should be tried first.
 * If and only if an earlier list fails to
 * produce equivalent expressions should later lists
 * be used.
 */
exports.simplificationOrder = [
    // Identity rules first
    [new ExponentToZero_1.ExponentToZero()],
    [new MultiplicativeIdentity_1.MultiplicativeIdentity()],
    [new ExponentialIdentity_1.ExponentialIdentity()],
    [new DivisionIdentity_1.DivisionIdentity()],
    [new AdditiveIdentity_1.AdditiveIdentity()],
    [new LogOfOne_1.LogOfOne()],
    beautifyingRules,
    evaluativeRules,
    combinatoricRules,
    remainingNoContextSimplificationRules,
];


/***/ }),

/***/ "./src/mathlib/derivations/Deriver.ts":
/*!********************************************!*\
  !*** ./src/mathlib/derivations/Deriver.ts ***!
  \********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Deriver = void 0;
const Argument_1 = __webpack_require__(/*! ../Argument */ "./src/mathlib/Argument.ts");
const Expression_1 = __webpack_require__(/*! ../expressions/Expression */ "./src/mathlib/expressions/Expression.ts");
const Graph_1 = __webpack_require__(/*! ../Graph */ "./src/mathlib/Graph.ts");
const GraphMinipulator_1 = __webpack_require__(/*! ../GraphMinipulator */ "./src/mathlib/GraphMinipulator.ts");
const Relationship_1 = __webpack_require__(/*! ../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const DerivationRules_1 = __webpack_require__(/*! ./DerivationRules */ "./src/mathlib/derivations/DerivationRules.ts");
const recursion_1 = __webpack_require__(/*! ./recursion */ "./src/mathlib/derivations/recursion.ts");
const RelationalDerivationRule_1 = __webpack_require__(/*! ./RelationalDerivationRule */ "./src/mathlib/derivations/RelationalDerivationRule.ts");
/**
 * Holds a single graph and expands it using rules.
 */
class Deriver {
    /**
     * Give it the graph you're going to expand.
     * @param graph
     */
    constructor(graph) {
        this.graph = graph;
        this.simplifiedInIsolation = new Set();
        this.notSimplifiable = new Set();
    }
    /**
     * Expands the graph arbitrarily.
     * This function is still poorly defined,
     * very experemental.
     */
    expand() {
        // Simplify all the expressions using the contextless simplifying rules
        // Do this until there's nothing more to simplify
        this.simplifyNoContext();
        //this.algebraicExpansion()
    }
    /**
     * Recursively makes sure that every node in the graph
     * is either simplified (meaning there is no contextless
     * rule that can simplify it further) or is marked down
     * as unsimplifiable.
     */
    simplifyNoContext() {
        const unsimplified = [...this.graph.getNodes()].filter(n => n instanceof Expression_1.Expression)
            .map(n => n)
            .filter(e => !this.simplifiedInIsolation.has(e));
        let shouldDoAgain = false;
        unsimplified.forEach(e => {
            this.simplifiedInIsolation.add(e);
            // Try to find equivalents using every set of rules.
            // If a set finds equivalents, move on to the next
            // expression instead of trying later rules to save
            // time.
            for (const rules of DerivationRules_1.simplificationOrder) {
                const derivedSimplifications = (0, recursion_1.equiv)(e, equivalentsFnUsing(rules));
                if (derivedSimplifications.length > 0) {
                    shouldDoAgain = true;
                    derivedSimplifications.forEach(a => {
                        this.graph.addArgument(a);
                    });
                    return; // To next expression
                }
            }
            // If none of the rules we have worked, the expression isn't simplifiable.
            this.notSimplifiable.add(e);
        });
        if (shouldDoAgain)
            this.simplifyNoContext();
    }
    /**
     * Expands the graph using algebra rules.
     * Only simplified rules are used.
     */
    algebraicExpansion() {
        const rules = [...RelationalDerivationRule_1.RelationalDerivationRule.rules];
        const components = [...GraphMinipulator_1.GraphMinipulator.getComponentNodes(this.graph, edge => {
                return (edge instanceof Argument_1.Argument && edge.relationship == Relationship_1.Relationship.Equal)
                    || (edge instanceof Graph_1.GivenEdge && edge.r == Relationship_1.Relationship.Equal);
            })];
        components.forEach(component => {
            const equation = [];
            for (const node of component) {
                if (node instanceof Expression_1.Expression && this.notSimplifiable.has(node))
                    equation.push(node);
            }
            rules.forEach(r => {
                r.apply((0, ThingsThatShouldBeInTheStdLib_1.setOf)(...equation)).forEach(a => {
                    this.graph.addArgument(a);
                });
            });
        });
    }
    graph;
    /**
     *
     * @returns true if the given expression is in the graph
     * and has already had the contextless simplification operations
     * done to it and cannot be further simplified.
     */
    isSimplified(exp) {
        return this.notSimplifiable.has(exp);
    }
    // A set of nodes in the graph which have had all simplification 
    // operations done to them.
    simplifiedInIsolation;
    // The set of nodes in the graph that have had contextless
    // simplification operations run on them and aren't further
    // simplifiable
    notSimplifiable;
}
exports.Deriver = Deriver;
/**
 * Function that makes a function that gets the equivalent
 * expressions for a given one.
 * @param rules What rules the resulting function should use to
 *      find equivalents.
 * @returns A function which will use the given rules to
 *      find direct equivalents.
 */
function equivalentsFnUsing(rules) {
    return function (exp) {
        const out = new Set();
        rules.filter(r => r.applies(exp)).forEach(rule => {
            rule.apply(exp).forEach(i => {
                out.add(i);
            });
        });
        return out;
    };
}


/***/ }),

/***/ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts":
/*!**************************************************************************!*\
  !*** ./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts ***!
  \**************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.NoContextExpressionSimplificationRule = void 0;
const assert_1 = __webpack_require__(/*! ../util/assert */ "./src/mathlib/util/assert.ts");
/**
 * A rule that takes an expression and produces one or more equivalent expressions.
 * These can use reflection to determine what
 * type of expression they're given. These rules will be recursively used
 * to derive simplified expressions.
 *
 * These rules are also contextless: they're only given the expression,
 * no other information about the problem.
 *
 * All of these rules need to converge to a simplified answer.
 */
class NoContextExpressionSimplificationRule {
    /**
     * Checks if this rule can find equivalents for the
     * given expression. Only call apply() if true.
     */
    applies(exp) {
        return this.appliesImpl(exp);
    }
    /**
     * Produces a set of expressions that are equivalent to
     * the given one. Only call if the given expression
     * passed the applies() test.
     * @param exp The expression to find an equivalent for.
     * @returns Set of equivalent expressions, not including the given one.
     */
    apply(exp) {
        //console.log(this.constructor.name + " on " + exp.toString())
        const result = this.applyImpl(exp);
        result.forEach(e => {
            (0, assert_1.assert)(e != null && e != undefined);
            (0, assert_1.assert)(e.claim.n1 !== exp, "Rule " + this.constructor.name + " produced result equivalent to ground");
            //if (this.constructor.name == "CombineCommonTermsMultiplication")
            //console.log(this.constructor.name + exp.toString() + "\n -> " + e.claim.n1.toString())
        });
        return result;
    }
}
exports.NoContextExpressionSimplificationRule = NoContextExpressionSimplificationRule;


/***/ }),

/***/ "./src/mathlib/derivations/RelationalDerivationRule.ts":
/*!*************************************************************!*\
  !*** ./src/mathlib/derivations/RelationalDerivationRule.ts ***!
  \*************************************************************/
/***/ ((__unused_webpack_module, exports) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.RelationalDerivationRule = void 0;
/**
 * Produces truths from a set of equivalent expressions.
 */
class RelationalDerivationRule {
    /**
     *
     * @param equation A set of expressions which are equal.
     */
    apply(equation) {
        return this.applyImpl(equation);
    }
    static rules = new Set();
}
exports.RelationalDerivationRule = RelationalDerivationRule;


/***/ }),

/***/ "./src/mathlib/derivations/algebra/DivideOnBothSides.ts":
/*!**************************************************************!*\
  !*** ./src/mathlib/derivations/algebra/DivideOnBothSides.ts ***!
  \**************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DivideOnBothSides = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const RelationalDerivationRule_1 = __webpack_require__(/*! ../RelationalDerivationRule */ "./src/mathlib/derivations/RelationalDerivationRule.ts");
class DivideOnBothSides extends RelationalDerivationRule_1.RelationalDerivationRule {
    applyImpl(equation) {
        const out = [];
        const combinations = cartesianProduct(equation);
        combinations.filter(pair => {
            return pair[0] instanceof Product_1.Product;
        }).forEach(pair => {
            const p = pair[0];
            const other = pair[1];
            // Some products have multiple factors
            p.factors.forEach(factor => {
                let second;
                if (other instanceof Product_1.Product) {
                    second = [...other.factors];
                }
                else {
                    second = [other];
                }
                const claim = { n: p.without(factor), n1: (0, ConvenientExpressions_1.fraction)((0, ConvenientExpressions_1.productOrNot)(...second), factor), r: Relationship_1.Relationship.Equal };
                out.push(new Argument_1.Argument(new Set([p, other]), claim, "a=b & c=d => a/c = b/d"));
            });
        });
        return out;
    }
}
exports.DivideOnBothSides = DivideOnBothSides;
/**
 * Gets the anti-reflexive closure of the relation A x A.
 * It's symmetric and transitive.
 *
 * @param set
 */
function cartesianProduct(set) {
    const out = [];
    for (const first of set) {
        for (const second of set) {
            if (first === second)
                continue;
            out.push([first, second]);
        }
    }
    return out;
}


/***/ }),

/***/ "./src/mathlib/derivations/algebra/SubtractFromBothSides.ts":
/*!******************************************************************!*\
  !*** ./src/mathlib/derivations/algebra/SubtractFromBothSides.ts ***!
  \******************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.SubtractFromBothSides = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Sum_1 = __webpack_require__(/*! ../../expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const RelationalDerivationRule_1 = __webpack_require__(/*! ../RelationalDerivationRule */ "./src/mathlib/derivations/RelationalDerivationRule.ts");
class SubtractFromBothSides extends RelationalDerivationRule_1.RelationalDerivationRule {
    applyImpl(equation) {
        const out = [];
        const combinations = cartesianProduct(equation);
        // If one is addition, subtract from both sides
        // Here we filter so that only pairs where the first expression is
        // a sum are operated on. This works because combinations is symetric.
        // Now for each pair we only have to deal with the first exp being sum.
        combinations.filter(pair => {
            return pair[0] instanceof Sum_1.Sum;
        }).forEach(pair => {
            const s = pair[0];
            const other = pair[1];
            // Some Sums have multiple terms
            s.terms.filter(term => !(term instanceof Product_1.Product && term.isNegation))
                .forEach(term => {
                // If other is itself a sum, we will break it apart
                // into terms so that we can combine integer terms in the
                // final result and avoid
                // x + 2 + 2 = y + 2 => x + 2 = y + 2 - 2
                // Note: We only do this to integer terms, because that's
                // so obvious and couldn't possibly need to be explained further.
                // We don't do it to variable terms. The following is correct behavior:
                // x + a + a = y + a => x + a = y + a - a
                // TODO: This distinction is debatable. Why shouldn't the left hand
                // of the last deduction be x + a + a - a? By doing this, 
                // we produce a much more complicated and expensive graph. 
                let second;
                if (other instanceof Sum_1.Sum) {
                    second = [...other.terms];
                }
                else {
                    second = [other];
                }
                const claim = { n: s.without(term), n1: (0, ConvenientExpressions_1.sumIntuitive)(...second, (0, ConvenientExpressions_1.negative)(term)), r: Relationship_1.Relationship.Equal };
                out.push(new Argument_1.Argument(new Set([s, other]), claim, "a=b & c=d => a-c = b-d"));
            });
        });
        return out;
    }
}
exports.SubtractFromBothSides = SubtractFromBothSides;
/**
 * Gets the anti-reflexive closure of the relation A x A.
 * It's symmetric and transitive.
 *
 * @param set
 */
function cartesianProduct(set) {
    const out = [];
    for (const first of set) {
        for (const second of set) {
            if (first === second)
                continue;
            out.push([first, second]);
        }
    }
    return out;
}


/***/ }),

/***/ "./src/mathlib/derivations/calculus/BreakDerivativesOverAddition.ts":
/*!**************************************************************************!*\
  !*** ./src/mathlib/derivations/calculus/BreakDerivativesOverAddition.ts ***!
  \**************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.BreakDerivativesOverAddition = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const Derivative_1 = __webpack_require__(/*! ../../expressions/Derivative */ "./src/mathlib/expressions/Derivative.ts");
const Sum_1 = __webpack_require__(/*! ../../expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
class BreakDerivativesOverAddition extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Derivative_1.Derivative
            && exp.exp instanceof Sum_1.Sum;
    }
    applyImpl(exp) {
        const d = exp;
        const sum = d.exp;
        const terms = [...sum.terms];
        const wrapped = terms.map(t => Derivative_1.Derivative.of(t, d.relativeTo));
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(d), {
            n: d,
            r: Relationship_1.Relationship.Equal,
            n1: Sum_1.Sum.of(wrapped),
        }, "Split derivative over addition"));
    }
}
exports.BreakDerivativesOverAddition = BreakDerivativesOverAddition;


/***/ }),

/***/ "./src/mathlib/derivations/calculus/PowerRule.ts":
/*!*******************************************************!*\
  !*** ./src/mathlib/derivations/calculus/PowerRule.ts ***!
  \*******************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PowerRule = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Derivative_1 = __webpack_require__(/*! ../../expressions/Derivative */ "./src/mathlib/expressions/Derivative.ts");
const Exponent_1 = __webpack_require__(/*! ../../expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * Derives using the power rule
 */
class PowerRule extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Derivative_1.Derivative
            && ((exp.exp instanceof Exponent_1.Exponent
                && exp.exp.base === exp.relativeTo
                && exp.exp.power.isConstant)
                || (exp.exp === exp.relativeTo));
    }
    /**
     * We know:
     * exp is a Derivative of an Exponent with a constant power
     * the exponent's base is the same as what the derivative is relative to
     */
    applyImpl(exp) {
        const d = exp;
        let exponent;
        if (d.exp instanceof Exponent_1.Exponent) {
            exponent = d.exp;
        }
        else {
            exponent = Exponent_1.Exponent.of(d.exp, (0, ConvenientExpressions_1.num)(1));
        }
        const result = (0, ConvenientExpressions_1.product)(exponent.power, Exponent_1.Exponent.of(exponent.base, (0, ConvenientExpressions_1.sumIntuitive)(exponent.power, (0, ConvenientExpressions_1.negative)((0, ConvenientExpressions_1.num)(1)))));
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: result
        }, "Power rule"));
    }
}
exports.PowerRule = PowerRule;


/***/ }),

/***/ "./src/mathlib/derivations/calculus/ProductRule.ts":
/*!*********************************************************!*\
  !*** ./src/mathlib/derivations/calculus/ProductRule.ts ***!
  \*********************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ProductRule = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Derivative_1 = __webpack_require__(/*! ../../expressions/Derivative */ "./src/mathlib/expressions/Derivative.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * Derivatives of products
 *
 * Only operates on derivatives of products where all factors are not constant.
 */
class ProductRule extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Derivative_1.Derivative
            && exp.exp instanceof Product_1.Product
            // Contains no constant factors
            && !exp.exp.factors.map(f => f.isConstant).reduce((a, b) => a || b);
        // Contains no derivatives TODO: Find a better solution to loop guarding
        //&& !exp.exp.factors.map<boolean>(f => f instanceof Derivative).reduce((a, b) => a || b)
    }
    applyImpl(exp) {
        const d = exp;
        const p = d.exp;
        const factors = p.factors;
        // For each factor, create a product containing its derivative and the other factors
        const terms = [];
        for (let i = 0; i < factors.length; i++) { // i is the factor to derivatize (what term we're on)
            const factorToDerivatize = factors[i];
            const pFactors = [];
            for (const factor of factors) { // a is the the factor we're on
                if (factor === factorToDerivatize)
                    pFactors.push(Derivative_1.Derivative.of(factor, d.relativeTo));
                else
                    pFactors.push(factor);
            }
            terms.push((0, ConvenientExpressions_1.product)(...pFactors));
        }
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(d), {
            n: d,
            r: Relationship_1.Relationship.Equal,
            n1: (0, ConvenientExpressions_1.sum)(...terms)
        }, "Product Rule"));
    }
}
exports.ProductRule = ProductRule;


/***/ }),

/***/ "./src/mathlib/derivations/calculus/PullConstantsFromDerivatives.ts":
/*!**************************************************************************!*\
  !*** ./src/mathlib/derivations/calculus/PullConstantsFromDerivatives.ts ***!
  \**************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PullConstantsFromDerivatives = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Derivative_1 = __webpack_require__(/*! ../../expressions/Derivative */ "./src/mathlib/expressions/Derivative.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
class PullConstantsFromDerivatives extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Derivative_1.Derivative
            && exp.exp instanceof Product_1.Product;
    }
    applyImpl(exp) {
        const d = exp;
        const p = d.exp;
        const constFactors = p.factors.filter(f => f.isConstant);
        const out = new Set;
        for (const factor of constFactors) {
            out.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(d), {
                n: d,
                r: Relationship_1.Relationship.Equal,
                n1: (0, ConvenientExpressions_1.productAndNotTimesOne)(factor, Derivative_1.Derivative.of((0, ConvenientExpressions_1.productOrNot)(...(0, ConvenientExpressions_1.removeNew)(p.factors, factor)), d.relativeTo))
            }, "Pull constant factor from derivative"));
        }
        return out;
    }
}
exports.PullConstantsFromDerivatives = PullConstantsFromDerivatives;


/***/ }),

/***/ "./src/mathlib/derivations/calculus/QuotientRule.ts":
/*!**********************************************************!*\
  !*** ./src/mathlib/derivations/calculus/QuotientRule.ts ***!
  \**********************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.QuotientRule = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Derivative_1 = __webpack_require__(/*! ../../expressions/Derivative */ "./src/mathlib/expressions/Derivative.ts");
const Exponent_1 = __webpack_require__(/*! ../../expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Fraction_1 = __webpack_require__(/*! ../../expressions/Fraction */ "./src/mathlib/expressions/Fraction.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
class QuotientRule extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Derivative_1.Derivative
            && exp.exp instanceof Fraction_1.Fraction;
    }
    applyImpl(exp) {
        const d = exp;
        const a = d.exp.numerator;
        const b = d.exp.denominator;
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: Fraction_1.Fraction.of((0, ConvenientExpressions_1.sum)((0, ConvenientExpressions_1.product)(Derivative_1.Derivative.of(a, d.relativeTo), b), (0, ConvenientExpressions_1.negative)((0, ConvenientExpressions_1.product)(a, Derivative_1.Derivative.of(b, d.relativeTo)))), Exponent_1.Exponent.of(b, (0, ConvenientExpressions_1.num)(2)))
        }, "Quotient Rule"));
    }
}
exports.QuotientRule = QuotientRule;


/***/ }),

/***/ "./src/mathlib/derivations/calculus/USubstitution.ts":
/*!***********************************************************!*\
  !*** ./src/mathlib/derivations/calculus/USubstitution.ts ***!
  \***********************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.USubstitution = void 0;
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
class USubstitution extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return false; //exp instanceof Integral
    }
    applyImpl(exp) {
        throw new Error("Not implemented");
    }
}
exports.USubstitution = USubstitution;


/***/ }),

/***/ "./src/mathlib/derivations/recursion.ts":
/*!**********************************************!*\
  !*** ./src/mathlib/derivations/recursion.ts ***!
  \**********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.equiv = void 0;
const Argument_1 = __webpack_require__(/*! ../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Derivative_1 = __webpack_require__(/*! ../expressions/Derivative */ "./src/mathlib/expressions/Derivative.ts");
const Exponent_1 = __webpack_require__(/*! ../expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Fraction_1 = __webpack_require__(/*! ../expressions/Fraction */ "./src/mathlib/expressions/Fraction.ts");
const Integer_1 = __webpack_require__(/*! ../expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Logarithm_1 = __webpack_require__(/*! ../expressions/Logarithm */ "./src/mathlib/expressions/Logarithm.ts");
const Product_1 = __webpack_require__(/*! ../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Sum_1 = __webpack_require__(/*! ../expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const Variable_1 = __webpack_require__(/*! ../expressions/Variable */ "./src/mathlib/expressions/Variable.ts");
const Relationship_1 = __webpack_require__(/*! ../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
/**
 * Gets all equivalents of the given expression
 * checking it's children's equivalents.
 *
 * (a + a) + (b + b)
 * -> (2a) + (b + b) with inference a + a = 2a
 * @param exp
 * @param directEquivalents Function that will produce equivalent expressions
 *        without recursion.
 * @returns Array of inferences to equivalent expressions.
 */
function equiv(exp, directEquivalents) {
    if (exp instanceof Variable_1.Variable || exp instanceof Integer_1.Integer)
        return [];
    else
        switch (exp.class) {
            case Sum_1.SumType: return sumEquiv(exp, directEquivalents);
            case Product_1.ProductType: return productEquiv(exp, directEquivalents);
            case Exponent_1.ExponentType: return exponentEquiv(exp, directEquivalents);
            case Fraction_1.FractionType: return fractionEquiv(exp, directEquivalents);
            case Derivative_1.DerivativeType: return derivativeEquiv(exp, directEquivalents);
            case Logarithm_1.LogType: return logarithmEquiv(exp, directEquivalents);
            default: throw new Error("Not implemented for " + exp.class);
        }
}
exports.equiv = equiv;
/**
 * Gets all equivalents of the given expression
 * by swapping out it's children individually.
 *
 * (a + a) + (b + b)
 * -> (2a) + (b + b) with inference a + a = 2a
 * @param exp
 * @returns Array of inferences to equivalent expressions.
 */
function sumEquiv(exp, directEquivalents) {
    const equivalentSums = new Set();
    // Add top level equivalents
    directEquivalents(exp).forEach(inf => {
        equivalentSums.add(inf);
    });
    // Find equivalents for each term
    for (let i = 0; i < exp.terms.length; i++) {
        const term = exp.terms[i];
        // Substitute term for each equivalent
        equiv(term, directEquivalents).forEach(a => {
            equivalentSums.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
                n: exp,
                r: Relationship_1.Relationship.Equal,
                n1: swap(exp, i, a.claim.n1)
            }, a.argument));
        });
    }
    function swap(s, i, e) {
        const terms = [...s.terms];
        terms[i] = e;
        return (0, ConvenientExpressions_1.sum)(...terms);
    }
    return [...equivalentSums];
}
function productEquiv(exp, directEquivalents) {
    const equivalentProducts = new Set();
    // Add top level equivalents
    directEquivalents(exp).forEach(inf => {
        equivalentProducts.add(inf);
    });
    // Find equivalents for each term
    for (let i = 0; i < exp.factors.length; i++) {
        const factor = exp.factors[i];
        // Substitute term for each equivalent
        equiv(factor, directEquivalents).forEach(alt => {
            equivalentProducts.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
                n: exp,
                r: Relationship_1.Relationship.Equal,
                n1: swap(exp, i, alt.claim.n1),
            }, alt.argument));
        });
    }
    function swap(s, i, e) {
        const terms = [...s.factors];
        terms[i] = e;
        return (0, ConvenientExpressions_1.product)(...terms);
    }
    return [...equivalentProducts];
}
function exponentEquiv(exp, directEquivalents) {
    const equivalents = new Set();
    // Add top level equivalents
    directEquivalents(exp).forEach(inf => {
        equivalents.add(inf);
    });
    equiv(exp.base, directEquivalents).forEach(alt => {
        equivalents.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: Exponent_1.Exponent.of(alt.claim.n1, exp.power)
        }, alt.argument));
    });
    equiv(exp.power, directEquivalents).forEach(alt => {
        equivalents.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: Exponent_1.Exponent.of(exp.base, alt.claim.n1),
        }, alt.argument));
    });
    return [...equivalents];
}
function fractionEquiv(exp, directEquivalents) {
    const equivalents = new Set();
    // Add top level equivalents
    directEquivalents(exp).forEach(inf => {
        equivalents.add(inf);
    });
    equiv(exp.numerator, directEquivalents).forEach(alt => {
        equivalents.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: Fraction_1.Fraction.of(alt.claim.n1, exp.denominator)
        }, alt.argument));
    });
    equiv(exp.denominator, directEquivalents).forEach(alt => {
        equivalents.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: Fraction_1.Fraction.of(exp.numerator, alt.claim.n1),
        }, alt.argument));
    });
    return [...equivalents];
}
function derivativeEquiv(exp, directEquivalents) {
    const equivalents = new Set();
    // Add top level equivalents
    directEquivalents(exp).forEach(inf => {
        equivalents.add(inf);
    });
    equiv(exp.exp, directEquivalents).forEach(alt => {
        equivalents.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: Derivative_1.Derivative.of(alt.claim.n1, exp.relativeTo)
        }, alt.argument));
    });
    equiv(exp.relativeTo, directEquivalents).forEach(alt => {
        equivalents.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: Derivative_1.Derivative.of(exp.exp, alt.claim.n1),
        }, alt.argument));
    });
    return [...equivalents];
}
function logarithmEquiv(exp, directEquivalents) {
    const equivalents = new Set();
    // Add top level equivalents
    directEquivalents(exp).forEach(arg => {
        equivalents.add(arg);
    });
    equiv(exp.exp, directEquivalents).forEach(alt => {
        equivalents.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: Logarithm_1.Logarithm.of(alt.claim.n1, exp.base)
        }, alt.argument));
    });
    equiv(exp.base, directEquivalents).forEach(alt => {
        equivalents.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: Logarithm_1.Logarithm.of(exp.exp, alt.claim.n1),
        }, alt.argument));
    });
    return [...equivalents];
}


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/AdditiveIdentity.ts":
/*!*********************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/AdditiveIdentity.ts ***!
  \*********************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.AdditiveIdentity = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Integer_1 = __webpack_require__(/*! ../../expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Sum_1 = __webpack_require__(/*! ../../expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * Anything plus 0 is anything
 */
class AdditiveIdentity extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Sum_1.Sum;
    }
    applyImpl(exp) {
        const termsWithoutZero = exp.terms.filter(t => !(t instanceof Integer_1.Integer && t.value == 0));
        if (termsWithoutZero.length == exp.terms.length)
            return (0, ThingsThatShouldBeInTheStdLib_1.setOf)();
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: (0, ConvenientExpressions_1.sumOrNot)(...termsWithoutZero)
        }, "Additive identity"));
    }
}
exports.AdditiveIdentity = AdditiveIdentity;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/AssociativePropertyOfProductsAndSums.ts":
/*!*****************************************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/AssociativePropertyOfProductsAndSums.ts ***!
  \*****************************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.AssociativePropertyOfProductsAndSums = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Sum_1 = __webpack_require__(/*! ../../expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * Flattens products in products and sums in sums
 */
class AssociativePropertyOfProductsAndSums extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Sum_1.Sum || exp instanceof Product_1.Product;
    }
    applyImpl(exp) {
        if (exp instanceof Sum_1.Sum) {
            const newTerms = exp.terms.map(t => {
                if (t instanceof Sum_1.Sum) {
                    return [...t.terms];
                }
                return [t];
            }).flat();
            if (newTerms.length == exp.terms.length)
                return new Set();
            return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
                n: exp,
                r: Relationship_1.Relationship.Equal,
                n1: (0, ConvenientExpressions_1.sum)(...newTerms)
            }, "Associative property of addition"));
        }
        else {
            if (exp.isNegation)
                return (0, ThingsThatShouldBeInTheStdLib_1.setOf)();
            const newFactors = exp.factors.map(t => {
                if (t instanceof Product_1.Product) {
                    return [...t.factors];
                }
                return [t];
            }).flat();
            if (newFactors.length == exp.factors.length)
                return new Set();
            return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
                n: exp,
                r: Relationship_1.Relationship.Equal,
                n1: (0, ConvenientExpressions_1.product)(...newFactors)
            }, "Associative property of multiplication"));
        }
    }
}
exports.AssociativePropertyOfProductsAndSums = AssociativePropertyOfProductsAndSums;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/CancelNegatives.ts":
/*!********************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/CancelNegatives.ts ***!
  \********************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CancelNegatives = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
const ConvenientExpressions_2 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
/**
 * Makes sure a product doesn't contain any negations.
 * The product is either a negation or not.
 */
class CancelNegatives extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Product_1.Product;
    }
    applyImpl(exp) {
        const product = exp;
        const negatedFactors = [];
        const others = [];
        for (const f of product.factors) {
            if (f instanceof Product_1.Product && f.isNegation) {
                negatedFactors.push(f);
            }
            else {
                others.push(f);
            }
        }
        if (negatedFactors.length < 1)
            return (0, ThingsThatShouldBeInTheStdLib_1.setOf)();
        const resultIsNegative = negatedFactors.length % 2 == 1;
        const result = (0, ConvenientExpressions_2.product)(...negatedFactors, ...others);
        const negatedResult = resultIsNegative ? (0, ConvenientExpressions_1.negative)(result) : result;
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: negatedResult
        }, "Cancel negatives"));
    }
}
exports.CancelNegatives = CancelNegatives;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/CombineCommonFactorsMultiplication.ts":
/*!***************************************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/CombineCommonFactorsMultiplication.ts ***!
  \***************************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CombineCommonFactorsMultiplication = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Exponent_1 = __webpack_require__(/*! ../../expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Sum_1 = __webpack_require__(/*! ../../expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * Combines like factors and exponents with like bases.
 */
class CombineCommonFactorsMultiplication extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Product_1.Product
            && !exp.isReducible;
    }
    applyImpl(exp) {
        const product = exp;
        const uniqueBases = new Set();
        for (const factor of product.factors) {
            if (factor instanceof Exponent_1.Exponent)
                uniqueBases.add(factor.base);
            else
                uniqueBases.add(factor);
        }
        const equivalentExpressions = new Set();
        // For every unique factor
        for (const base of uniqueBases) {
            let powerTerms = [];
            let remainingFactors = [];
            // Count the number of times it occurs in the product
            // Collect the other factors in a list
            for (const f of product.factors) {
                if (f instanceof Exponent_1.Exponent) {
                    if (f.base === base)
                        powerTerms.push(f.power);
                }
                else {
                    if (f === base) {
                        powerTerms.push((0, ConvenientExpressions_1.num)(1));
                    }
                    else {
                        remainingFactors.push(f);
                    }
                }
            }
            // Order the power terms correctly
            powerTerms = (0, Sum_1.orderTerms)(...powerTerms);
            // If it occured multiple times, create a new exponent
            // To combine the repeats
            if (powerTerms.length > 1) {
                const exponent = Exponent_1.Exponent.of(base, (0, ConvenientExpressions_1.sum)(...powerTerms));
                if (remainingFactors.length == 0) {
                    equivalentExpressions.add(exponent);
                }
                else {
                    // Insert the new exponent at the correct place in the new product
                    function insertCorrectly(arr, el) {
                        // Pick index
                        let index = 0;
                        for (let i = 0; i < arr.length; i++) {
                            if ((0, Product_1.factorOrder)(el, arr[i]) >= 0) {
                                index = i + 1;
                                break;
                            }
                        }
                        arr.splice(index, 0, el);
                    }
                    insertCorrectly(remainingFactors, exponent);
                    equivalentExpressions.add(Product_1.Product.of(remainingFactors));
                }
            }
        }
        // Turn the equivalent expressions into inferences
        let inferences = new Set();
        equivalentExpressions.forEach(e => {
            inferences.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(product), {
                n: product,
                r: Relationship_1.Relationship.Equal,
                n1: e,
            }, "Combine common factors multiplication"));
        });
        return inferences;
    }
}
exports.CombineCommonFactorsMultiplication = CombineCommonFactorsMultiplication;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/CombineCommonTermsAddition.ts":
/*!*******************************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/CombineCommonTermsAddition.ts ***!
  \*******************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CombineCommonTermsAddition = void 0;
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
const Sum_1 = __webpack_require__(/*! ../../expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
/**
 * a + a = 2a
 * 2a - a = a  (this means we have to check for negations)
 *
 * (bc)a + 7a = (7 + bc)a
 *
 * But not
 * 1 + 1 = 2(1)
 */
class CombineCommonTermsAddition extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Sum_1.Sum
            && !exp.isReducible;
    }
    applyImpl(exp) {
        const sum = exp;
        const uniqueFactors = new Set();
        const args = new Set();
        // Find all unique factors in all terms
        // Don't consider the -1 in negations
        // Consider the factors of negated products separately
        for (const term of sum.terms) {
            if (term instanceof Product_1.Product) {
                if (term.isNegation)
                    if (term.negation instanceof Product_1.Product) {
                        (0, ThingsThatShouldBeInTheStdLib_1.addAll)(uniqueFactors, ...term.negation.factors);
                    }
                    else
                        uniqueFactors.add(term.negation);
                else
                    (0, ThingsThatShouldBeInTheStdLib_1.addAll)(uniqueFactors, ...term.factors); //TODO: Capture all combinations of factors
            }
            else
                uniqueFactors.add(term);
        }
        // Create an argument for pulling out each factor
        for (const factor of uniqueFactors) {
            // Don't waste time with unhealthy factors
            if (factor.isReducibleOrInt)
                continue;
            // Figure out which terms contain it
            const relaventTerms = [];
            const otherTerms = [];
            for (const term of sum.terms) {
                if (term instanceof Product_1.Product) {
                    if (term.isNegation) {
                        // If it's a negation, check if the negation has it
                        if (term.negation === factor)
                            relaventTerms.push(term);
                        else if (term.negation instanceof Product_1.Product) {
                            if ((0, ThingsThatShouldBeInTheStdLib_1.has)(term.negation.factors, factor))
                                relaventTerms.push(term);
                            else
                                otherTerms.push(term);
                        }
                    }
                    else if ((0, ThingsThatShouldBeInTheStdLib_1.has)(term.factors, factor))
                        relaventTerms.push(term);
                    else
                        otherTerms.push(term);
                }
                else {
                    if (term === factor)
                        relaventTerms.push(Product_1.Product.of([(0, ConvenientExpressions_1.num)(1), term]));
                    else
                        otherTerms.push(term);
                }
            }
            // Pull it out of those terms
            const coefficients = [];
            if (relaventTerms.length < 2)
                continue;
            for (const term of relaventTerms) {
                if (term.isNegation) {
                    if (term.negation instanceof Product_1.Product) {
                        coefficients.push((0, ConvenientExpressions_1.negative)(term.negation.without(factor)));
                    }
                    else
                        coefficients.push((0, ConvenientExpressions_1.negative)((0, ConvenientExpressions_1.num)(1)));
                }
                else {
                    coefficients.push(term.without(factor));
                }
            }
            const pulled = (0, ConvenientExpressions_1.sumOrNot)((0, ConvenientExpressions_1.orderedProduct)(Sum_1.Sum.of(coefficients), factor), ...otherTerms);
            args.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
                n: exp,
                r: Relationship_1.Relationship.Equal,
                n1: pulled
            }, "Combine like terms"));
        }
        return args;
    }
}
exports.CombineCommonTermsAddition = CombineCommonTermsAddition;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/CombineIntegerFactors.ts":
/*!**************************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/CombineIntegerFactors.ts ***!
  \**************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CombineIntegerFactors = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Integer_1 = __webpack_require__(/*! ../../expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * Products with several integer terms are simplified to only include 1
 */
class CombineIntegerFactors extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Product_1.Product
            && !exp.isNegation;
    }
    applyImpl(exp) {
        const p = exp;
        const remainingFactors = [];
        let coefficient = 1;
        for (const f of p.factors) {
            if (f instanceof Integer_1.Integer) {
                coefficient *= f.value;
            }
            else
                remainingFactors.push(f);
        }
        if (p.factors.length - remainingFactors.length < 2)
            return new Set();
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: (0, ConvenientExpressions_1.productOrNot)((0, ConvenientExpressions_1.num)(coefficient), ...remainingFactors)
        }, "Multiply integer terms"));
    }
}
exports.CombineIntegerFactors = CombineIntegerFactors;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/DivideFractions.ts":
/*!********************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/DivideFractions.ts ***!
  \********************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DivideFractions = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Exponent_1 = __webpack_require__(/*! ../../expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Fraction_1 = __webpack_require__(/*! ../../expressions/Fraction */ "./src/mathlib/expressions/Fraction.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
class DivideFractions extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Fraction_1.Fraction
            && exp.numerator instanceof Product_1.Product
            && exp.denominator instanceof Product_1.Product;
    }
    applyImpl(exp) {
        const frac = exp;
        const num = frac.numerator;
        const den = frac.denominator;
        // Take the factors of the negation of any negations
        const numFactors = num.isNegation ?
            num.negation instanceof Product_1.Product ?
                num.negation.factors // Get factors if the negation is a product
                : [num.negation] // If negation isn't a product, return the negation as a list of 1
            : num.factors; // If not a negation, return the factors
        const denFactors = !den.isNegation ? den.factors
            : den.negation instanceof Product_1.Product ?
                den.negation.factors
                : [den.negation];
        // If there are any repeats, give up
        if (new Set(numFactors).size < numFactors.length)
            return (0, ThingsThatShouldBeInTheStdLib_1.setOf)();
        if (new Set(denFactors).size < denFactors.length)
            return (0, ThingsThatShouldBeInTheStdLib_1.setOf)();
        // Treat every factor as an exponent
        const numExponents = numFactors.map(f => {
            if (f instanceof Exponent_1.Exponent)
                return f;
            else
                return Exponent_1.Exponent.of(f, (0, ConvenientExpressions_1.num)(1));
        });
        const denExponents = denFactors.map(f => {
            if (f instanceof Exponent_1.Exponent)
                return f;
            else
                return Exponent_1.Exponent.of(f, (0, ConvenientExpressions_1.num)(1));
        });
        // For each den exponent base, create an overall sum of the powers
        const numExponentPowers = new Map();
        numExponents.forEach(exponent => {
            if (!numExponentPowers.has(exponent.base))
                numExponentPowers.set(exponent.base, []);
            numExponentPowers.get(exponent.base).push(exponent.power);
        });
        const denExponentPowers = new Map();
        denExponents.forEach(exponent => {
            if (!denExponentPowers.has(exponent.base))
                denExponentPowers.set(exponent.base, []);
            denExponentPowers.get(exponent.base).push(exponent.power);
        });
        // Any base which is in the numerator and denominator
        // will only be in the numerator
        const newNumExponentPowers = new Map(numExponentPowers);
        const newDenExponentPowers = new Map(denExponentPowers);
        denExponentPowers.forEach((powers, base) => {
            if (numExponentPowers.has(base)) {
                newNumExponentPowers.get(base).push((0, ConvenientExpressions_1.negative)((0, ConvenientExpressions_1.sumOrNot)(...powers)));
                newDenExponentPowers.delete(base);
            }
        });
        // Get the new factors for the numerator and denominator
        const newNumExponents = [];
        newNumExponentPowers.forEach((powers, base) => {
            newNumExponents.push(Exponent_1.Exponent.of(base, (0, ConvenientExpressions_1.sumOrNot)(...powers)));
        });
        const newDenExponents = [];
        newDenExponentPowers.forEach((powers, base) => {
            newDenExponents.push(Exponent_1.Exponent.of(base, (0, ConvenientExpressions_1.sumOrNot)(...powers)));
        });
        const top = (0, ConvenientExpressions_1.productOrNot)(...newNumExponents);
        const bottom = newDenExponents.length != 0 ? (0, ConvenientExpressions_1.productOrNot)(...newDenExponents) : (0, ConvenientExpressions_1.num)(1);
        // Preserve the negations removed earlier
        const result = Fraction_1.Fraction.of(num.isNegation ? (0, ConvenientExpressions_1.negative)(top) : top, den.isNegation ? (0, ConvenientExpressions_1.negative)(bottom) : bottom);
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: result
        }, "Cancel out fractions"));
    }
}
exports.DivideFractions = DivideFractions;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/DivisionIdentity.ts":
/*!*********************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/DivisionIdentity.ts ***!
  \*********************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DivisionIdentity = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const Fraction_1 = __webpack_require__(/*! ../../expressions/Fraction */ "./src/mathlib/expressions/Fraction.ts");
const Integer_1 = __webpack_require__(/*! ../../expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * Anything divided by 1 is the numerator
 */
class DivisionIdentity extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Fraction_1.Fraction
            && exp.denominator instanceof Integer_1.Integer
            && exp.denominator.value == 1;
    }
    applyImpl(exp) {
        const frac = exp;
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(frac), {
            n: frac,
            r: Relationship_1.Relationship.Equal,
            n1: frac.numerator,
        }, "Division identity is 1"));
    }
}
exports.DivisionIdentity = DivisionIdentity;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/EvaluateSums.ts":
/*!*****************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/EvaluateSums.ts ***!
  \*****************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.EvaluateSums = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Integer_1 = __webpack_require__(/*! ../../expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Sum_1 = __webpack_require__(/*! ../../expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * Combine any integer terms in Sums.
 * a + 2 + 2 + 2= a + 4
 * 2 - 2 = 0
 *
 * Combines all of them at once no matter how many terms there are.
 *
 */
class EvaluateSums extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Sum_1.Sum;
    }
    applyImpl(exp) {
        const sum = exp;
        const integerTerms = [...sum.terms].filter(t => t instanceof Integer_1.Integer || (t instanceof Product_1.Product && t.isNegation && t.negation instanceof Integer_1.Integer));
        if (integerTerms.length < 2) {
            return (0, ThingsThatShouldBeInTheStdLib_1.setOf)();
        }
        const newInt = Integer_1.Integer.of(integerTerms.map(e => {
            if (e instanceof Integer_1.Integer) {
                return e.value;
            }
            return -e.negation.value;
        }).reduce((a, b) => a + b));
        const otherTerms = [...sum.terms].filter(t => !(t instanceof Integer_1.Integer) && !(t instanceof Product_1.Product && t.isNegation && t.negation instanceof Integer_1.Integer));
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(sum), {
            n: sum,
            r: Relationship_1.Relationship.Equal,
            n1: (0, ConvenientExpressions_1.sumOrNot)(...otherTerms, newInt)
        }, "Evaluated Addition"));
    }
}
exports.EvaluateSums = EvaluateSums;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/ExponentToZero.ts":
/*!*******************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/ExponentToZero.ts ***!
  \*******************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ExponentToZero = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Exponent_1 = __webpack_require__(/*! ../../expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Integer_1 = __webpack_require__(/*! ../../expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
class ExponentToZero extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Exponent_1.Exponent
            && exp.power instanceof Integer_1.Integer
            && exp.power.value == 0;
    }
    applyImpl(exp) {
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: (0, ConvenientExpressions_1.num)(1)
        }, "Anything to zero is zero"));
    }
}
exports.ExponentToZero = ExponentToZero;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/ExponentialIdentity.ts":
/*!************************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/ExponentialIdentity.ts ***!
  \************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ExponentialIdentity = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const Exponent_1 = __webpack_require__(/*! ../../expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Integer_1 = __webpack_require__(/*! ../../expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * Anything to the first is just that thing.
 * Turns any exponent with a power of 1 to that thing.
 */
class ExponentialIdentity extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Exponent_1.Exponent
            && exp.power instanceof Integer_1.Integer
            && exp.power.value == 1;
    }
    applyImpl(exp) {
        const e = exp;
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(e), {
            n: e,
            r: Relationship_1.Relationship.Equal,
            n1: e.base,
        }, "Exponential Identity is 1"));
    }
}
exports.ExponentialIdentity = ExponentialIdentity;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/LogOfOne.ts":
/*!*************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/LogOfOne.ts ***!
  \*************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LogOfOne = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Integer_1 = __webpack_require__(/*! ../../expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Logarithm_1 = __webpack_require__(/*! ../../expressions/Logarithm */ "./src/mathlib/expressions/Logarithm.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
class LogOfOne extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Logarithm_1.Logarithm
            && exp.exp instanceof Integer_1.Integer
            && exp.exp.value === 1;
    }
    applyImpl(exp) {
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: (0, ConvenientExpressions_1.num)(0)
        }, "Log in any base of 1 is 0"));
    }
}
exports.LogOfOne = LogOfOne;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/MultiplicativeIdentity.ts":
/*!***************************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/MultiplicativeIdentity.ts ***!
  \***************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.MultiplicativeIdentity = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Integer_1 = __webpack_require__(/*! ../../expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * 1x = x
 * 1*1x = 1
 */
class MultiplicativeIdentity extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Product_1.Product
            && new Set(exp.factors).has((0, ConvenientExpressions_1.num)(1))
            && !exp.isNegation;
    }
    applyImpl(exp) {
        const p = exp;
        const newFactors = [];
        for (const factor of p.factors) {
            if (factor instanceof Integer_1.Integer && factor.value == 1)
                continue;
            newFactors.push(factor);
        }
        if (newFactors.length == 0)
            newFactors.push((0, ConvenientExpressions_1.num)(1));
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: (0, ConvenientExpressions_1.productOrNot)(...newFactors)
        }, "Multiplicative Identity"));
    }
}
exports.MultiplicativeIdentity = MultiplicativeIdentity;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/MultiplyExponentPowers.ts":
/*!***************************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/MultiplyExponentPowers.ts ***!
  \***************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.MultiplyExponentPowers = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Exponent_1 = __webpack_require__(/*! ../../expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
class MultiplyExponentPowers extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Exponent_1.Exponent
            && exp.base instanceof Exponent_1.Exponent;
    }
    applyImpl(exp) {
        const outer = exp;
        const inner = outer.base;
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
            n: exp,
            r: Relationship_1.Relationship.Equal,
            n1: Exponent_1.Exponent.of(inner.base, (0, ConvenientExpressions_1.product)(inner.power, outer.power))
        }, "Exponents to exponents multiply"));
    }
}
exports.MultiplyExponentPowers = MultiplyExponentPowers;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/OrderSums.ts":
/*!**************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/OrderSums.ts ***!
  \**************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.OrderSums = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Sum_1 = __webpack_require__(/*! ../../expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * Turns sums that are unhealthy because their term order
 * is wrong into correctly ordered sums.
 */
class OrderSums extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Sum_1.Sum && (0, ConvenientExpressions_1.orderedSum)(exp) !== exp;
    }
    applyImpl(exp) {
        return new Set([new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
                n: exp,
                r: Relationship_1.Relationship.Equal,
                n1: (0, ConvenientExpressions_1.orderedSum)(exp),
            }, "Reordered")]);
    }
}
exports.OrderSums = OrderSums;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/RemoveCommonFactorsOnTopAndBottomOfFraction.ts":
/*!************************************************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/RemoveCommonFactorsOnTopAndBottomOfFraction.ts ***!
  \************************************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.RemoveCommonFactorsFromTopAndBottomOfFraction = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Fraction_1 = __webpack_require__(/*! ../../expressions/Fraction */ "./src/mathlib/expressions/Fraction.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
class RemoveCommonFactorsFromTopAndBottomOfFraction extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Fraction_1.Fraction
            && !(exp.numerator instanceof Product_1.Product && exp.numerator.isNegation)
            && !(exp.denominator instanceof Product_1.Product && exp.denominator.isNegation);
    }
    applyImpl(exp) {
        const frac = exp;
        const top = frac.numerator;
        const bottom = frac.denominator;
        const allFactors = new Set();
        if (top instanceof Product_1.Product) {
            top.factors.forEach(f => allFactors.add(f));
        }
        else
            allFactors.add(top);
        if (bottom instanceof Product_1.Product) {
            bottom.factors.forEach(f => allFactors.add(f));
        }
        else
            allFactors.add(bottom);
        // Find factors that are in both top and bottom
        const inBoth = new Set();
        allFactors.forEach(f => {
            if ((top instanceof Product_1.Product ? (0, ThingsThatShouldBeInTheStdLib_1.has)(top.factors, f) : top === f)
                && (bottom instanceof Product_1.Product ? (0, ThingsThatShouldBeInTheStdLib_1.has)(bottom.factors, f) : bottom === f))
                inBoth.add(f);
        });
        if (inBoth.size == 0)
            return (0, ThingsThatShouldBeInTheStdLib_1.setOf)();
        // Return new fraction without those
        let newTop = top;
        inBoth.forEach(f => {
            if (newTop instanceof Product_1.Product) {
                newTop = newTop.without(f);
            }
            else {
                newTop = (0, ConvenientExpressions_1.num)(1);
            }
        });
        let newBottom = bottom;
        inBoth.forEach(f => {
            if (newBottom instanceof Product_1.Product) {
                newBottom = newBottom.without(f);
            }
            else {
                newBottom = (0, ConvenientExpressions_1.num)(1);
            }
        });
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(frac), {
            n: frac,
            r: Relationship_1.Relationship.Equal,
            n1: Fraction_1.Fraction.of(newTop, newBottom),
        }, "Divide top and bottom by same thing"));
    }
}
exports.RemoveCommonFactorsFromTopAndBottomOfFraction = RemoveCommonFactorsFromTopAndBottomOfFraction;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/SubtractExponentsOnFractions.ts":
/*!*********************************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/SubtractExponentsOnFractions.ts ***!
  \*********************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.SubtractExponentsOnFractions = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Exponent_1 = __webpack_require__(/*! ../../expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Fraction_1 = __webpack_require__(/*! ../../expressions/Fraction */ "./src/mathlib/expressions/Fraction.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * In all cases, any combined exponent factors will
 * be put in the numerator. It's hard to know if they
 * will evaluate to be negative or not, so we'll put
 * them all in the numerator and deal with that later.
 * TODO: Maybe we could iterate over the graph after it's
 *      done to go back and fix this? Maybe it's worth the 2^n
 *      added complexity to create nodes for every possible placement
 *      then just pathfind the easiest?
 */
class SubtractExponentsOnFractions extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Fraction_1.Fraction;
    }
    applyImpl(exp) {
        const frac = exp;
        const top = frac.numerator instanceof Product_1.Product ? frac.numerator.factors : [frac.numerator];
        const bottom = frac.denominator instanceof Product_1.Product ? frac.denominator.factors : [frac.denominator];
        // Treat every factor of top and bottom as an exponent
        function asExponent(f) {
            if (f instanceof Exponent_1.Exponent)
                return f;
            else
                return Exponent_1.Exponent.of(f, (0, ConvenientExpressions_1.num)(1));
        }
        const topExponents = top.map(asExponent);
        const bottomExponents = bottom.map(asExponent);
        // Find what bases are common
        const commonBases = new Set();
        topExponents.forEach(e => {
            if ((0, ThingsThatShouldBeInTheStdLib_1.has)(bottomExponents.map(e => e.base), e.base))
                commonBases.add(e.base);
        });
        bottomExponents.forEach(e => {
            if ((0, ThingsThatShouldBeInTheStdLib_1.has)(topExponents.map(e => e.base), e.base))
                commonBases.add(e.base);
        });
        if (commonBases.size == 0)
            return (0, ThingsThatShouldBeInTheStdLib_1.setOf)();
        // Separate factors which won't be effected
        const uneffectedTopFactors = top.filter(f => {
            if (f instanceof Exponent_1.Exponent)
                return !commonBases.has(f.base);
            return !commonBases.has(f);
        });
        const uneffectedBottomFactors = bottom.filter(f => {
            if (f instanceof Exponent_1.Exponent)
                return !commonBases.has(f.base);
            return !commonBases.has(f);
        });
        // Find all the terms for each base
        // Remember that the final exponent will be in the numerator
        const exponentTerms = new Map();
        topExponents.forEach(e => {
            if (!commonBases.has(e.base))
                return;
            if (!exponentTerms.has(e.base)) {
                exponentTerms.set(e.base, []);
            }
            exponentTerms.get(e.base).push(e.power);
        });
        bottomExponents.forEach(e => {
            if (!commonBases.has(e.base))
                return;
            if (!exponentTerms.has(e.base)) {
                exponentTerms.set(e.base, []);
            }
            // Negative bc we're putting these in the numerator
            exponentTerms.get(e.base).push((0, ConvenientExpressions_1.negative)(e.power));
        });
        const resultingTopExponents = [];
        exponentTerms.forEach((powerTerms, base) => {
            resultingTopExponents.push(Exponent_1.Exponent.of(base, (0, ConvenientExpressions_1.sum)(...powerTerms)));
        });
        if (uneffectedBottomFactors.length == 0)
            uneffectedBottomFactors.push((0, ConvenientExpressions_1.num)(1));
        return (0, ThingsThatShouldBeInTheStdLib_1.setOf)(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(frac), {
            n: frac,
            r: Relationship_1.Relationship.Equal,
            n1: Fraction_1.Fraction.of((0, ConvenientExpressions_1.productOrNot)(...resultingTopExponents, ...uneffectedTopFactors), (0, ConvenientExpressions_1.productOrNot)(...uneffectedBottomFactors)),
        }, "Sum exponents in both numerator and denominator"));
    }
}
exports.SubtractExponentsOnFractions = SubtractExponentsOnFractions;


/***/ }),

/***/ "./src/mathlib/derivations/simplifications/SumCoefficientsOfAddedTerms.ts":
/*!********************************************************************************!*\
  !*** ./src/mathlib/derivations/simplifications/SumCoefficientsOfAddedTerms.ts ***!
  \********************************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.SumCoefficientsOfAddedTerms = void 0;
const Argument_1 = __webpack_require__(/*! ../../Argument */ "./src/mathlib/Argument.ts");
const ConvenientExpressions_1 = __webpack_require__(/*! ../../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Integer_1 = __webpack_require__(/*! ../../expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Product_1 = __webpack_require__(/*! ../../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Sum_1 = __webpack_require__(/*! ../../expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const Relationship_1 = __webpack_require__(/*! ../../Relationship */ "./src/mathlib/Relationship.ts");
const ThingsThatShouldBeInTheStdLib_1 = __webpack_require__(/*! ../../util/ThingsThatShouldBeInTheStdLib */ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts");
const NoContextExpressionSimplificationRule_1 = __webpack_require__(/*! ../NoContextExpressionSimplificationRule */ "./src/mathlib/derivations/NoContextExpressionSimplificationRule.ts");
/**
 * Takes sums of several added products and combines ones that only
 * have different coefficients.
 *
 * a + 2a = 3a
 * a - 2a = -1a
 */
class SumCoefficientsOfAddedTerms extends NoContextExpressionSimplificationRule_1.NoContextExpressionSimplificationRule {
    appliesImpl(exp) {
        return exp instanceof Sum_1.Sum;
    }
    applyImpl(exp) {
        const terms = exp.terms;
        // Split the terms into product and not products
        const productTerms = [];
        const nonProductTerms = [];
        for (const term of terms) {
            if (term instanceof Product_1.Product && term.factors[0] instanceof Integer_1.Integer) {
                productTerms.push(term);
            }
            else {
                nonProductTerms.push(term);
            }
        }
        // Sort the product terms into groups of common factors
        const groups = new Map();
        for (const term of productTerms) {
            const first = term.factors[0];
            const temp = [...term.factors];
            temp.splice(0, 1);
            const group = (0, ConvenientExpressions_1.productOrNot)(...temp);
            if (!groups.has(group))
                groups.set(group, { coefficient: first.value, moreThanOne: false });
            else {
                groups.get(group).coefficient += first.value;
                groups.get(group).moreThanOne = true;
            }
        }
        // For every group with more than one product, produce a new argument
        const out = new Set();
        groups.forEach((obj, group) => {
            if (!obj.moreThanOne)
                return;
            const productTermsNotCombined = productTerms.filter(t => {
                const temp = [...t.factors];
                temp.splice(0, 1);
                const termWithoutLeadingCoefficient = (0, ConvenientExpressions_1.productOrNot)(...temp);
                return group !== termWithoutLeadingCoefficient;
            });
            out.add(new Argument_1.Argument((0, ThingsThatShouldBeInTheStdLib_1.setOf)(exp), {
                n: exp,
                r: Relationship_1.Relationship.Equal,
                n1: (0, ConvenientExpressions_1.sumOrNot)((0, ConvenientExpressions_1.productAndNotTimesOne)((0, ConvenientExpressions_1.num)(obj.coefficient), group), ...nonProductTerms, ...productTermsNotCombined)
            }, "Combining like terms"));
        });
        return out;
    }
}
exports.SumCoefficientsOfAddedTerms = SumCoefficientsOfAddedTerms;


/***/ }),

/***/ "./src/mathlib/expressions/Derivative.ts":
/*!***********************************************!*\
  !*** ./src/mathlib/expressions/Derivative.ts ***!
  \***********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DerivativeType = exports.Derivative = void 0;
const Expression_1 = __webpack_require__(/*! ./Expression */ "./src/mathlib/expressions/Expression.ts");
const Product_1 = __webpack_require__(/*! ./Product */ "./src/mathlib/expressions/Product.ts");
const Sum_1 = __webpack_require__(/*! ./Sum */ "./src/mathlib/expressions/Sum.ts");
/**
 *
 */
class Derivative extends Expression_1.Expression {
    static of(exp, relativeTo) {
        const hash = exp.hash + relativeTo.hash;
        if (!this.instances.has(hash))
            this.instances.set(hash, new Derivative(exp, relativeTo));
        return this.instances.get(hash);
    }
    static instances = new Map();
    constructor(exp, relativeTo) {
        super();
        this.exp = exp;
        this.relativeTo = relativeTo;
        Object.freeze(this.exp);
        Object.freeze(this.relativeTo);
        this.isReducible = false; //TODO: Determine if a derivative is reducible
        this.isConstant = false; // TODO: Determine if a derivative is constant
        this.childCount = 2 + exp.childCount + relativeTo.childCount;
    }
    exp;
    relativeTo;
    isReducible;
    class = exports.DerivativeType;
    toString() {
        return "d/d" + this.relativeTo.toString() + "(" + this.exp.toString() + ")";
    }
    toUnambigiousString() {
        return "(d/d" + this.relativeTo.toUnambigiousString() + ")" + this.exp.toUnambigiousString();
    }
    get hash() {
        return this.class + this.exp.hash + this.relativeTo.hash;
    }
    toMathXML() {
        function wrapIfNeeded(exp) {
            if (exp.class == Sum_1.SumType || exp.class == Product_1.ProductType)
                return "<mo>(</mo>" + exp.toMathXML() + "<mo>)</mo>";
            return exp.toMathXML();
        }
        return "<mfrac><mn>d</mn><mrow><mn>d</mn>" + wrapIfNeeded(this.relativeTo) + "</mrow></mfrac>" + wrapIfNeeded(this.exp);
    }
    isConstant;
    childCount;
}
exports.Derivative = Derivative;
exports.DerivativeType = "Derivative";


/***/ }),

/***/ "./src/mathlib/expressions/Exponent.ts":
/*!*********************************************!*\
  !*** ./src/mathlib/expressions/Exponent.ts ***!
  \*********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ExponentType = exports.Exponent = void 0;
const MathMLHelpers_1 = __webpack_require__(/*! ../util/MathMLHelpers */ "./src/mathlib/util/MathMLHelpers.ts");
const Expression_1 = __webpack_require__(/*! ./Expression */ "./src/mathlib/expressions/Expression.ts");
const Product_1 = __webpack_require__(/*! ./Product */ "./src/mathlib/expressions/Product.ts");
const Sum_1 = __webpack_require__(/*! ./Sum */ "./src/mathlib/expressions/Sum.ts");
class Exponent extends Expression_1.Expression {
    static of(base, power) {
        const hash = base.hash + power.hash;
        if (!Exponent.instances.has(hash)) {
            Exponent.instances.set(hash, new Exponent(base, power));
        }
        return Exponent.instances.get(hash);
    }
    static instances = new Map();
    class = exports.ExponentType;
    toMathXML() {
        function wrapIfNeeded(exp) {
            if (exp.class == Sum_1.SumType || exp.class == Product_1.ProductType)
                return (0, MathMLHelpers_1.inRow)((0, MathMLHelpers_1.inParen)(exp.toMathXML()));
            return exp.toMathXML();
        }
        return "<msup>" + wrapIfNeeded(this.base) + (0, MathMLHelpers_1.inRow)(this.power.toMathXML()) + "</msup>";
    }
    toString() {
        return "(" + this.base + ")^(" + this.power + ")";
    }
    toUnambigiousString() {
        return "(" + this.base + ")^(" + this.power + ")";
    }
    get hash() {
        return "Exponent" + this.base.hash + this.power.hash;
    }
    constructor(base, power) {
        super();
        this.base = base;
        this.power = power;
        Object.freeze(this.base);
        Object.freeze(this.power);
        // The integers are closed over exponentiation
        this.isReducible = (base.isReducibleOrInt) && (power.isReducibleOrInt); // && Math.pow(base.reduced.value, power.reduced.value) % 1 == 0
        this.isConstant = base.isConstant && power.isConstant;
        this.childCount = 2 + base.childCount + power.childCount;
    }
    base;
    power;
    isReducible;
    isConstant;
    childCount;
}
exports.Exponent = Exponent;
exports.ExponentType = "Exponent";


/***/ }),

/***/ "./src/mathlib/expressions/Expression.ts":
/*!***********************************************!*\
  !*** ./src/mathlib/expressions/Expression.ts ***!
  \***********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Expression = void 0;
const MathGraphNode_1 = __webpack_require__(/*! ../MathGraphNode */ "./src/mathlib/MathGraphNode.ts");
const Integer_1 = __webpack_require__(/*! ./Integer */ "./src/mathlib/expressions/Integer.ts");
/**
 * Base of all mathematical expressions.
 * All children should implement fly-wheel pattern.
 * All children should be immutable.
 */
class Expression extends MathGraphNode_1.MathGraphNode {
    /**
     * True if the expression is reducible or is an integer.
     */
    get isReducibleOrInt() {
        return this.isReducible || this.class == Integer_1.IntegerType;
    }
}
exports.Expression = Expression;


/***/ }),

/***/ "./src/mathlib/expressions/Fraction.ts":
/*!*********************************************!*\
  !*** ./src/mathlib/expressions/Fraction.ts ***!
  \*********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.FractionType = exports.Fraction = void 0;
const Expression_1 = __webpack_require__(/*! ./Expression */ "./src/mathlib/expressions/Expression.ts");
class Fraction extends Expression_1.Expression {
    static of(numerator, denominator) {
        const hash = numerator.hash + denominator.hash;
        if (!this.instance.has(hash))
            this.instance.set(hash, new Fraction(numerator, denominator));
        return this.instance.get(hash);
    }
    static instance = new Map();
    constructor(num, denom) {
        super();
        this.numerator = num;
        this.denominator = denom;
        Object.freeze(this.numerator);
        Object.freeze(this.denominator);
        /*
        A fraction is reducible if the denom | num.
            <=> num = k * denom where k is an integer.

        This makes proving reducibility hard.
        TODO: Decide if it's worth implementing reducibility for Fractions
        */
        this.isReducible = false;
        this.isConstant = num.isConstant && denom.isConstant;
        this.childCount = 2 + num.childCount + denom.childCount;
    }
    numerator;
    denominator;
    isReducible;
    class = exports.FractionType;
    toString() {
        return this.numerator.toString() + " / " + this.denominator.toString();
    }
    toUnambigiousString() {
        return `${this.numerator.toUnambigiousString()}/${this.denominator.toUnambigiousString()}`;
    }
    get hash() {
        return exports.FractionType + this.numerator.hash + this.denominator.hash;
    }
    isConstant;
    toMathXML() {
        return "<mfrac><mrow>" + this.numerator.toMathXML() + "</mrow><mrow>" + this.denominator.toMathXML() + "</mrow></mfrac>";
    }
    childCount;
}
exports.Fraction = Fraction;
exports.FractionType = "Fraction";


/***/ }),

/***/ "./src/mathlib/expressions/Integer.ts":
/*!********************************************!*\
  !*** ./src/mathlib/expressions/Integer.ts ***!
  \********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.IntegerType = exports.Integer = void 0;
const assert_1 = __webpack_require__(/*! ../util/assert */ "./src/mathlib/util/assert.ts");
const Expression_1 = __webpack_require__(/*! ./Expression */ "./src/mathlib/expressions/Expression.ts");
/**
 * Integer
 * Positive or negative
 */
class Integer extends Expression_1.Expression {
    static of(value) {
        if (!Integer.instances.has(value)) {
            Integer.instances.set(value, new Integer(value));
        }
        return Integer.instances.get(value);
    }
    static instances = new Map();
    constructor(value) {
        super();
        this.value = value;
        (0, assert_1.assert)(this.value % 1 == 0, "Creating non-integer integer " + this.value);
    }
    /**
     * @returns A positive version of this integer.
     */
    butPositive() {
        return Integer.of(Math.abs(this.value));
    }
    class = exports.IntegerType;
    toMathXML() {
        return "<mn>" + this.value + "</mn>";
    }
    toString() {
        return "" + this.value;
    }
    toUnambigiousString() {
        return "" + this.value;
    }
    get hash() {
        return "NumberExp" + this.value;
    }
    value;
    isReducible = false;
    isConstant = true;
    childCount = 0;
}
exports.Integer = Integer;
exports.IntegerType = "Integer";


/***/ }),

/***/ "./src/mathlib/expressions/Integral.ts":
/*!*********************************************!*\
  !*** ./src/mathlib/expressions/Integral.ts ***!
  \*********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.IntegralType = exports.Integral = void 0;
const MathMLHelpers_1 = __webpack_require__(/*! ../util/MathMLHelpers */ "./src/mathlib/util/MathMLHelpers.ts");
const Expression_1 = __webpack_require__(/*! ./Expression */ "./src/mathlib/expressions/Expression.ts");
const Product_1 = __webpack_require__(/*! ./Product */ "./src/mathlib/expressions/Product.ts");
const Sum_1 = __webpack_require__(/*! ./Sum */ "./src/mathlib/expressions/Sum.ts");
/**
 * An indefinate integral (for now).
 * TODO: Should we separate definate/indefinate integrals?
 */
class Integral extends Expression_1.Expression {
    static of(integrand, relativeTo) {
        if (!this.instances.has(integrand.hash + relativeTo.hash))
            this.instances.set(integrand.hash + relativeTo.hash, new Integral(integrand, relativeTo));
        return this.instances.get(integrand.hash + relativeTo.hash);
    }
    static instances = new Map();
    constructor(integrand, relativeTo) {
        super();
        this.integrand = integrand;
        this.relativeTo = relativeTo;
        Object.freeze(this.integrand);
        Object.freeze(this.relativeTo);
        this.isReducible = false;
        this.isConstant = false;
        this.childCount = 2 + integrand.childCount + relativeTo.childCount;
    }
    integrand;
    relativeTo;
    isReducible;
    class = exports.IntegralType;
    toString() {
        return "∫" + this.integrand.toString();
    }
    toUnambigiousString() {
        return "∫(" + this.integrand.toUnambigiousString() + ")" + this.relativeTo.toUnambigiousString();
    }
    get hash() {
        return "∫" + this.integrand.toString() + this.relativeTo.toString();
    }
    isConstant;
    toMathXML() {
        function wrapIfNeeded(exp) {
            if (exp.class == Sum_1.SumType || exp.class == Product_1.ProductType)
                return (0, MathMLHelpers_1.inParen)(exp.toMathXML());
            return exp.toMathXML();
        }
        return "<mrow><mo>∫</mo>" + wrapIfNeeded(this.integrand) + "<mn>d</mn>" + wrapIfNeeded(this.relativeTo) + "</mrow>";
    }
    childCount;
}
exports.Integral = Integral;
exports.IntegralType = "Integral";


/***/ }),

/***/ "./src/mathlib/expressions/Logarithm.ts":
/*!**********************************************!*\
  !*** ./src/mathlib/expressions/Logarithm.ts ***!
  \**********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LogType = exports.Logarithm = void 0;
const Expression_1 = __webpack_require__(/*! ./Expression */ "./src/mathlib/expressions/Expression.ts");
class Logarithm extends Expression_1.Expression {
    static of(exp, base) {
        const hash = exp.hash + base.hash;
        if (!this.instances.has(hash))
            this.instances.set(hash, new Logarithm(exp, base));
        return this.instances.get(hash);
    }
    static instances = new Map();
    constructor(exp, base) {
        super();
        this.exp = exp;
        this.base = base;
        Object.freeze(this.exp);
        Object.freeze(this.base);
        this.isReducible = false; //TODO: Determine if a logarithm is reducible
        this.isConstant = exp.isConstant && base.isConstant;
        this.childCount = 2 + exp.childCount + base.childCount;
    }
    toMathXML() {
        return `<mrow>
            <msub><mtext>log</mtext>${this.base.toMathXML()}</msub>
            <mrow>${this.exp.toMathXML()}</mrow>
        </row>`;
    }
    isReducible;
    class = exports.LogType;
    toString() {
        return `log${this.base.toString()}(${this.exp.toString()})`;
    }
    toUnambigiousString() {
        return `log(${this.base.toUnambigiousString()})(${this.base.toUnambigiousString()})`;
    }
    get hash() {
        throw new Error("Method not implemented.");
    }
    isConstant;
    childCount;
    exp;
    base;
}
exports.Logarithm = Logarithm;
exports.LogType = "Logarithm";


/***/ }),

/***/ "./src/mathlib/expressions/Product.ts":
/*!********************************************!*\
  !*** ./src/mathlib/expressions/Product.ts ***!
  \********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.factorOrder = exports.ProductType = exports.Product = void 0;
const assert_1 = __webpack_require__(/*! ../util/assert */ "./src/mathlib/util/assert.ts");
const Expression_1 = __webpack_require__(/*! ./Expression */ "./src/mathlib/expressions/Expression.ts");
const Integer_1 = __webpack_require__(/*! ./Integer */ "./src/mathlib/expressions/Integer.ts");
const Sum_1 = __webpack_require__(/*! ./Sum */ "./src/mathlib/expressions/Sum.ts");
/**
 * A mathematical product with 2 or more factors.
 */
class Product extends Expression_1.Expression {
    /**
     * For efficiency, products are compared by reference.
     * Here we ensure === <=> ==
     * @param factors
     * @returns
     */
    static of(factors) {
        const hash = factors.map(e => e.hash).join("");
        if (!Product.instances.has(hash))
            Product.instances.set(hash, new Product(factors));
        return Product.instances.get(hash);
    }
    static instances = new Map();
    constructor(factors) {
        super();
        (0, assert_1.assert)(factors.length >= 2, "Creating product with less than 2 factors.");
        this.factors = factors;
        Object.freeze(this.factors);
        let reducible = true;
        this.factors.forEach(f => {
            reducible &&= f.isReducible || f.class == Integer_1.IntegerType;
        });
        // The integers are closed over multiplication
        this.isReducible = reducible;
        let healthy = true;
        healthy &&= this.numNegatives() < 2;
        let isNegation = factors.length == 2;
        isNegation &&= factors.filter(e => {
            return e instanceof Integer_1.Integer && e.value == -1;
        }).length == 1;
        this.isNegation = isNegation;
        this.isConstant = this.factors.map(f => f.isConstant).reduce((a, b) => a && b);
        this.childCount = factors.length + factors.map(f => f.childCount).reduce((a, b) => a + b) - (this.isNegation ? 1 : 0);
    }
    /**
     * True if this product is just
     * -1 * another expression.
     */
    isNegation;
    /**
     * Get the value that this product is negating
     * -1 * exp returns exp.
     * @throws if product isn't a negation.
     */
    get negation() {
        (0, assert_1.assert)(this.isNegation, "Trying to get negation from non-negating sum");
        if (this.factors[0].class == Integer_1.IntegerType && this.factors[0].value == -1)
            return this.factors[1];
        return this.factors[0];
    }
    /**
     * Returns a new Expression without the given factor.
     * If the product contains the factor multiple times,
     * only removes one. If it doesn't contain the factor,
     * returns itself.
     * @param exp A factor in this product.
     */
    without(exp) {
        const newFactors = [...this.factors];
        const index = newFactors.findIndex((value) => {
            return value === exp;
        });
        if (index == -1)
            return this;
        newFactors.splice(index, 1);
        if (newFactors.length < 2) {
            return newFactors[0]; // Gauranteed there's one term here
        }
        return Product.of(newFactors);
    }
    toMathXML() {
        let out = "";
        function wrapIfNeeded(exp) {
            if (exp.class == exports.ProductType || exp.class == Sum_1.SumType)
                return "<mo>(</mo>" + exp.toMathXML() + "<mo>)</mo>";
            return exp.toMathXML();
        }
        // Either this is a negation, or a list of products
        // First the negation case...
        if (this.isNegation) {
            out += "<mo>-</mo>";
            out += wrapIfNeeded(this.negation);
            return out;
        }
        // If it's a list of products...
        const firstFactor = this.factors[0];
        out += wrapIfNeeded(firstFactor);
        for (let i = 1; i < this.factors.length; i++) {
            let factor = this.factors[i];
            let needsDot = (factor.class == Integer_1.IntegerType && this.factors[i - 1].class == Integer_1.IntegerType)
                || (factor instanceof Product && factor.isNegation) // If there's a negative sign, get a dot
                || (factor instanceof Integer_1.Integer && factor.value < 1);
            if (needsDot)
                out += "<mo>·</mo>";
            out += wrapIfNeeded(factor);
        }
        return out;
    }
    /**
     * @returns Number of negative integer products.
     */
    numNegatives() {
        let count = 0;
        this.factors.forEach(f => {
            if (f instanceof Integer_1.Integer)
                if (f.value < 0)
                    count++;
        });
        return count;
    }
    toString() {
        let out = "";
        for (const exp of this.factors) {
            if (exp instanceof Product) {
                out += "(" + exp.toString() + ")";
            }
            else {
                out += exp.toString();
            }
            out += "·";
        }
        out = out.substring(0, out.length - 1);
        return out;
    }
    toUnambigiousString() {
        if (this.isNegation)
            return `-(${this.negation.toUnambigiousString()})`;
        let out = "";
        for (const exp of this.factors) {
            if (exp instanceof Product) {
                out += "(" + exp.toString() + ")";
            }
            else {
                out += exp.toString();
            }
            out += "·";
        }
        out = out.substring(0, out.length - 1);
        return out;
    }
    get hash() {
        return "Product" + this.factors.map(e => e.hash).join();
    }
    // At least 2 elements, order matters
    factors;
    class = exports.ProductType;
    isReducible;
    isConstant;
    childCount;
}
exports.Product = Product;
exports.ProductType = "Product";
/**
 * Can be used in array.sort() to get properly ordered products.
 *
 * @param a
 * @param b
 * @returns Positive if a should be after b
 */
function factorOrder(a, b) {
    if (a instanceof Integer_1.Integer && b instanceof Integer_1.Integer)
        return 0;
    if (a instanceof Integer_1.Integer) {
        return aFirst;
    }
    return 0;
}
exports.factorOrder = factorOrder;
const aFirst = 1;
const aAfter = -1;


/***/ }),

/***/ "./src/mathlib/expressions/Sum.ts":
/*!****************************************!*\
  !*** ./src/mathlib/expressions/Sum.ts ***!
  \****************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.orderTerms = exports.SumType = exports.Sum = void 0;
const assert_1 = __webpack_require__(/*! ../util/assert */ "./src/mathlib/util/assert.ts");
const Expression_1 = __webpack_require__(/*! ./Expression */ "./src/mathlib/expressions/Expression.ts");
const Integer_1 = __webpack_require__(/*! ./Integer */ "./src/mathlib/expressions/Integer.ts");
const Product_1 = __webpack_require__(/*! ./Product */ "./src/mathlib/expressions/Product.ts");
const Variable_1 = __webpack_require__(/*! ./Variable */ "./src/mathlib/expressions/Variable.ts");
/**
 * Expression representing the sum of 2 or more terms.
 */
class Sum extends Expression_1.Expression {
    /**
     * Factory method consntructor.
     * @param terms Contains at least 2 elements
     */
    static of(terms) {
        const hash = terms.map(t => t.hash).join("");
        if (!Sum.instances.has(hash)) {
            Sum.instances.set(hash, new Sum(terms));
        }
        return Sum.instances.get(hash);
    }
    static instances = new Map();
    constructor(terms) {
        super();
        (0, assert_1.assert)(terms.length >= 2, "Creating sum with less than 2 terms.");
        this.terms = terms;
        this.isReducible = this.terms.map(t => t.isReducible || t.class == Integer_1.IntegerType).reduce((a, b) => a && b);
        this.isConstant = this.terms.map(t => t.isConstant).reduce((a, b) => a && b);
        Object.freeze(this.terms);
        this.childCount = terms.length + terms.map(t => t.childCount).reduce((a, b) => a + b);
    }
    /**
     * Returns a new Expression without the given term.
     * If the sum contains the term multiple times,
     * only removes one. If it doesn't contain the term,
     * returns itself.
     * @param term A term in this sum.
     */
    without(term) {
        const newTerms = [...this.terms];
        const index = newTerms.findIndex((value) => {
            return value === term;
        });
        if (index == -1)
            return this;
        newTerms.splice(index, 1);
        if (newTerms.length < 2) {
            return newTerms[0]; // Gauranteed there's one term here
        }
        return Sum.of(newTerms);
    }
    toMathXML() {
        function wrapIfNeeded(exp) {
            if (exp.class == exports.SumType)
                return "<mo>(</mo>" + exp.toMathXML() + "<mo>)</mo>";
            return exp.toMathXML();
        }
        let out = wrapIfNeeded(this.terms[0]);
        for (let i = 1; i < this.terms.length; i++) {
            const term = this.terms[i];
            // Subtract negative terms instead of adding negatives
            if (term instanceof Product_1.Product && term.isNegation) {
                out += "<mo>-</mo>" + wrapIfNeeded(term.negation);
            }
            else if (term instanceof Integer_1.Integer && term.value < 0) {
                out += "<mo>-</mo>" + wrapIfNeeded(term.butPositive());
            }
            else {
                out += "<mo>+</mo>" + wrapIfNeeded(this.terms[i]);
            }
        }
        return out;
    }
    toString() {
        let out = "";
        for (const exp of this.terms) {
            out += exp.toString() + "+";
        }
        out = out.substring(0, out.length - 1);
        return out;
    }
    toUnambigiousString() {
        let out = "";
        for (const exp of this.terms) {
            out += "(" + exp.toUnambigiousString() + ")+";
        }
        out = out.substring(0, out.length - 1);
        return out;
    }
    get hash() {
        return "Sum" + this.terms.map(e => e.hash).join();
    }
    class = exports.SumType;
    /**
     * Ordered, immutable
     */
    terms;
    isReducible;
    isConstant;
    childCount;
}
exports.Sum = Sum;
exports.SumType = "Sum";
/**
 * Returns the given terms ordered correctly to
 * be placed in a Sum. Alters the given array.
 * @param terms
 */
function orderTerms(...terms) {
    // A note about the sort function bc the documentation is cryptic
    // If a should be put before b in the sum, return a negative value
    return terms.sort((a, b) => {
        // Variables before Integers
        if (a.class == Integer_1.IntegerType && (b.class == Variable_1.VariableType || (b instanceof Product_1.Product && b.isNegation && b.negation.class == Variable_1.VariableType))) {
            return 1;
        }
        if ((a.class == Variable_1.VariableType || (a instanceof Product_1.Product && a.isNegation && a.negation.class == Variable_1.VariableType)) && b.class == Integer_1.IntegerType) {
            return -1;
        }
        return 0;
    });
}
exports.orderTerms = orderTerms;


/***/ }),

/***/ "./src/mathlib/expressions/Variable.ts":
/*!*********************************************!*\
  !*** ./src/mathlib/expressions/Variable.ts ***!
  \*********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.VariableType = exports.Variable = void 0;
const Expression_1 = __webpack_require__(/*! ./Expression */ "./src/mathlib/expressions/Expression.ts");
class Variable extends Expression_1.Expression {
    static of(symbol) {
        if (Variable.instances.get(symbol) == undefined) {
            Variable.instances.set(symbol, new Variable(symbol));
        }
        return Variable.instances.get(symbol);
    }
    static instances = new Map();
    constructor(symbol) {
        super();
        this.symbol = symbol;
    }
    class = exports.VariableType;
    toMathXML() {
        return "<mi>" + this.symbol + "</mi>";
    }
    toString() {
        return this.symbol;
    }
    toUnambigiousString() {
        return this.symbol;
    }
    get hash() {
        return "Variable" + this.symbol;
    }
    symbol;
    isReducible = false;
    isConstant = false;
    childCount = 0;
}
exports.Variable = Variable;
exports.VariableType = "Variable";


/***/ }),

/***/ "./src/mathlib/uielements/ArgumentNodeView.ts":
/*!****************************************************!*\
  !*** ./src/mathlib/uielements/ArgumentNodeView.ts ***!
  \****************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ArgumentNodeView = void 0;
const GraphNodeView_1 = __webpack_require__(/*! ./GraphNodeView */ "./src/mathlib/uielements/GraphNodeView.ts");
/**
 * Represents an argument node.
 */
class ArgumentNodeView extends GraphNodeView_1.GraphNodeView {
    constructor(arg, setStyle) {
        super(setStyle);
        this.argument = arg;
    }
    connectedCallback() {
        this.textContent = this.argument.argument;
    }
    argument;
}
exports.ArgumentNodeView = ArgumentNodeView;
customElements.define("argument-nodeview", ArgumentNodeView, { extends: "div" });


/***/ }),

/***/ "./src/mathlib/uielements/EdgeView.ts":
/*!********************************************!*\
  !*** ./src/mathlib/uielements/EdgeView.ts ***!
  \********************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.EdgeView = void 0;
const Argument_1 = __webpack_require__(/*! ../Argument */ "./src/mathlib/Argument.ts");
const UIPreferences_1 = __webpack_require__(/*! ./UIPreferences */ "./src/mathlib/uielements/UIPreferences.ts");
const Graph_1 = __webpack_require__(/*! ../Graph */ "./src/mathlib/Graph.ts");
/**
 * Represents an edge in a graph.
 */
class EdgeView extends HTMLParagraphElement {
    constructor(owner, edge) {
        super();
        this.owner = owner;
        this.edge = edge.e;
        this.first = edge.n;
        this.second = edge.n1;
        Object.freeze(this.edge);
        this.style.width = "fit-content";
        this.style.height = "fit-content";
        this.style.padding = "0";
        this.style.zIndex = "-2";
        this.style.margin = "0";
        this.style.whiteSpace = "nowrap";
        this.style.textAlign = "center";
        this.style.backgroundColor = UIPreferences_1.uiPreferences.edgeEqualsBackgroundColor;
        this.style.userSelect = "none";
        this.style.backgroundColor = "white";
        UIPreferences_1.uiPreferences.onUpdate(() => {
            this.style.backgroundColor = UIPreferences_1.uiPreferences.edgeEqualsBackgroundColor;
        });
        this.addEventListener("click", event => {
            this.owner.edgeClicked(this, event);
        });
        this.addEventListener("mouseout", event => {
        });
    }
    /**
     * Sets rotation angle of view while also
     * letting it know the angle has changed.
     * @param rad
     */
    setAngle(rad) {
        this.style.rotate = "" + rad + "rad";
        //this.textContent = "" + (rad * 2 * Math.PI / 360).toFixed(2) + "deg"
    }
    /**
     * Sets element screen width and ensures text fits
     * inside the edge.
     */
    set width(val) {
        super.style.width = val;
    }
    /**
     * Called when element is conncted to the DOM.
     */
    connectedCallback() {
        if (this.edge instanceof Argument_1.Argument) {
            this.textContent = "" + this.edge.claim.r;
        }
        else if (this.edge instanceof Graph_1.GivenEdge) {
            this.textContent = "" + this.edge.r;
        }
        else
            throw new Error("Not implemented for " + this.edge);
    }
    owner;
    edge;
    first;
    second;
}
exports.EdgeView = EdgeView;
customElements.define("edge-view", EdgeView, { extends: "p" });


/***/ }),

/***/ "./src/mathlib/uielements/EditableMathView.ts":
/*!****************************************************!*\
  !*** ./src/mathlib/uielements/EditableMathView.ts ***!
  \****************************************************/
/***/ ((__unused_webpack_module, exports) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.EditableMathView = void 0;
/**
 * Displays math and is editable.
 */
class EditableMathView extends HTMLDivElement {
    constructor() {
        super();
        this.addEventListener("click", event => {
        });
    }
    connectedCallback() {
    }
    set value(e) {
        this._value = e;
        this.innerHTML = "<math display='block'>" + (e?.toMathXML() ?? "") + "</math>";
        this.listeners.forEach(l => l(this._value));
        MathJax.typeset([this]);
    }
    get value() {
        return this._value;
    }
    /**
     * Listener will be called whenever the math
     * in the view is edited.
     * @param l
     */
    addEditListener(l) {
        this.listeners.push(l);
    }
    listeners = [];
    _value = null;
}
exports.EditableMathView = EditableMathView;
customElements.define("editable-mathview", EditableMathView, { extends: "div" });


/***/ }),

/***/ "./src/mathlib/uielements/ExplanationPopup.ts":
/*!****************************************************!*\
  !*** ./src/mathlib/uielements/ExplanationPopup.ts ***!
  \****************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ExplanationPopup = void 0;
const Expression_1 = __webpack_require__(/*! ../expressions/Expression */ "./src/mathlib/expressions/Expression.ts");
const MathMLHelpers_1 = __webpack_require__(/*! ../util/MathMLHelpers */ "./src/mathlib/util/MathMLHelpers.ts");
class ExplanationPopup extends HTMLDivElement {
    /**
     *
     * @param arg
     * @param onClose Called after user clicks close button.
     */
    constructor(arg, onClose) {
        super();
        this.arg = arg;
        this.onClose = onClose;
        const closeButton = document.createElement('b');
        closeButton.addEventListener('click', () => {
            this.onClose();
        });
        closeButton.textContent = "Close";
        closeButton.style.userSelect = "none";
        closeButton.style.float = "right";
        this.append(closeButton);
        const text = document.createElement('div');
        text.innerHTML = arg.argument + "<br>";
        if (arg.claim.n instanceof Expression_1.Expression && arg.claim.n1 instanceof Expression_1.Expression)
            text.innerHTML += (0, MathMLHelpers_1.inMathBlock)((0, MathMLHelpers_1.inRow)(arg.claim.n.toMathXML() + " <mo>" + arg.claim.r + "</mo> " + arg.claim.n1.toMathXML())) + "<br> Derived from: <br>";
        for (const ground of arg.grounds) {
            if (ground instanceof Expression_1.Expression)
                text.innerHTML += (0, MathMLHelpers_1.inMath)(ground.toMathXML()) + "<br>";
        }
        this.append(text);
        this.style.backgroundColor = "white";
        this.style.border = "1px solid black";
        this.style.boxShadow = "0.3ch 0.3ch 0.6ch rgba(0, 0, 0, 0.5)";
        this.style.padding = "1ch";
        this.style.width = "fit-content";
        this.style.zIndex = "15";
    }
    connectedCallback() {
        MathJax.typeset([this]);
    }
    arg;
    onClose;
}
exports.ExplanationPopup = ExplanationPopup;
customElements.define("explanation-popup", ExplanationPopup, { extends: "div" });


/***/ }),

/***/ "./src/mathlib/uielements/ExpressionNodeView.ts":
/*!******************************************************!*\
  !*** ./src/mathlib/uielements/ExpressionNodeView.ts ***!
  \******************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ExpressionNodeView = void 0;
const EditableMathView_1 = __webpack_require__(/*! ./EditableMathView */ "./src/mathlib/uielements/EditableMathView.ts");
const GraphNodeView_1 = __webpack_require__(/*! ./GraphNodeView */ "./src/mathlib/uielements/GraphNodeView.ts");
/**
 * A graph node view for expression nodes.
 */
class ExpressionNodeView extends GraphNodeView_1.GraphNodeView {
    constructor(node, setStyle) {
        super(setStyle);
        this.node = node;
        this.editableMathView = new EditableMathView_1.EditableMathView();
        this.editableMathView.value = this.node;
        this.appendChild(this.editableMathView);
        this.addEventListener("click", () => {
            console.log(this.node.toString());
        });
    }
    connectedCallback() {
    }
    node;
    editableMathView;
}
exports.ExpressionNodeView = ExpressionNodeView;
customElements.define("expression-nodeview", ExpressionNodeView, { extends: "div" });
const colorUnhealthyNodes = true;


/***/ }),

/***/ "./src/mathlib/uielements/GraphNodeView.ts":
/*!*************************************************!*\
  !*** ./src/mathlib/uielements/GraphNodeView.ts ***!
  \*************************************************/
/***/ ((__unused_webpack_module, exports) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.GraphNodeView = void 0;
/**
 * An html element that represents a math graph node.
 */
class GraphNodeView extends HTMLDivElement {
    /**
     *
     * @param setStyle Function that when called
     *  should set the style for this view.
     */
    constructor(setStyle) {
        super();
        this.style.padding = "1ch";
        this.style.width = "fit-content";
        this.style.height = "fit-content";
        this.style.whiteSpace = "nowrap";
        setStyle(this);
    }
    set backgroundColor(value) {
        this.style.backgroundColor = value;
    }
}
exports.GraphNodeView = GraphNodeView;


/***/ }),

/***/ "./src/mathlib/uielements/TouchGestureRecognizer.ts":
/*!**********************************************************!*\
  !*** ./src/mathlib/uielements/TouchGestureRecognizer.ts ***!
  \**********************************************************/
/***/ ((__unused_webpack_module, exports) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.TouchGestureRecognizer = void 0;
/**
 * Interpret complicated touch gesture data.
 */
class TouchGestureRecognizer {
    constructor() {
        this.moveListeners = [];
        this.pinchListeners = [];
    }
    addMoveListener(callback) {
        this.moveListeners.push(callback);
    }
    /**
     * Adds a function that will be called when a pinch gesture has been detected.
     * @param callback Takes a center coordinate that's the average of the finger positions,
     *              the change in scale since the last call on (0, infinity) where 1 is no change,
     *              and the number of fingers in the gesture (an integer).
     */
    addPinchListener(callback) {
        this.pinchListeners.push(callback);
    }
    /**
     * Should take all touch events from the view using it.
     * @param event
     */
    processTouchDown(event) {
    }
    /**
     * Should take all touch events from the view using it.
     * @param event
     */
    processTouchMove(event) {
        for (const changed of event.changedTouches) {
            changed.clientX;
        }
    }
    /**
     * Should take all touch events from the view using it.
     * @param event
     */
    processTouchEnd(event) {
    }
    /**
     * Should take all touch events from the view using it.
     * @param event
     */
    processTouchCancel(event) {
    }
    //private lastX: Map<Touch
    moveListeners;
    pinchListeners;
}
exports.TouchGestureRecognizer = TouchGestureRecognizer;


/***/ }),

/***/ "./src/mathlib/uielements/UIPreferences.ts":
/*!*************************************************!*\
  !*** ./src/mathlib/uielements/UIPreferences.ts ***!
  \*************************************************/
/***/ ((__unused_webpack_module, exports) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.uiPreferences = void 0;
class UIPreferences {
    /**
     * @param callback Function called whenever a ui preference
     * is changed.
     */
    onUpdate(callback) {
        this.callbacks.push(callback);
    }
    // Getters and Setters
    /**
     * Background color of a graph edge denoting
     * equality between two expressions.
     * Css value.
     */
    get edgeEqualsBackgroundColor() {
        return this._edgeEqualsBackgroundColor;
    }
    set edgeEqualsBackgroundColor(val) {
        this._edgeEqualsBackgroundColor = val;
        this.callbacks.forEach(c => c());
    }
    // Preference Values
    _edgeEqualsBackgroundColor = "none";
    callbacks = [];
}
exports.uiPreferences = new UIPreferences();


/***/ }),

/***/ "./src/mathlib/uielements/WebGraphView.ts":
/*!************************************************!*\
  !*** ./src/mathlib/uielements/WebGraphView.ts ***!
  \************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.WebGraphView = void 0;
const Argument_1 = __webpack_require__(/*! ../Argument */ "./src/mathlib/Argument.ts");
const Expression_1 = __webpack_require__(/*! ../expressions/Expression */ "./src/mathlib/expressions/Expression.ts");
const GraphMinipulator_1 = __webpack_require__(/*! ../GraphMinipulator */ "./src/mathlib/GraphMinipulator.ts");
const assert_1 = __webpack_require__(/*! ../util/assert */ "./src/mathlib/util/assert.ts");
const TouchGestureRecognizer_1 = __webpack_require__(/*! ./TouchGestureRecognizer */ "./src/mathlib/uielements/TouchGestureRecognizer.ts");
const EdgeView_1 = __webpack_require__(/*! ./EdgeView */ "./src/mathlib/uielements/EdgeView.ts");
const ExpressionNodeView_1 = __webpack_require__(/*! ./ExpressionNodeView */ "./src/mathlib/uielements/ExpressionNodeView.ts");
const ArgumentNodeView_1 = __webpack_require__(/*! ./ArgumentNodeView */ "./src/mathlib/uielements/ArgumentNodeView.ts");
const ExplanationPopup_1 = __webpack_require__(/*! ./ExplanationPopup */ "./src/mathlib/uielements/ExplanationPopup.ts");
/**
 * A ui element that will display a math graph in a web.
 */
class WebGraphView extends HTMLDivElement {
    /**
     * @param graph Must be fully connected.
     * @param roots Non-empty.
     */
    constructor(graph, roots, config = undefined) {
        super();
        this.graph = graph;
        this.nodes = new Map();
        this.offsetX = 0;
        this.offsetY = 0;
        this.nodePositions = new Map();
        this.edgePositions = new Map();
        this.edges = new Map();
        this.rootNodes = new Set(roots);
        this.ringElements = new Set();
        this.ringPositions = new Map();
        this.explanationPopups = [];
        if (config != undefined) {
            this.showArguments = config.showArguments;
            this.drawEdgeLines = config.drawEdgeLines;
            this.debugCornerEnabled = config.debugCornerEnabled;
        }
        this.style.clipPath = "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)";
        this.style.position = "relative";
        this.style.overflow = "hidden";
        this.addEventListener("mousedown", event => {
            this.mouseDown = true;
            this.touchDown = false;
        });
        this.addEventListener("mouseup", event => {
            this.mouseDown = false;
        });
        this.addEventListener("mouseleave", event => {
            this.mouseDown = false;
        });
        this.addEventListener("mousemove", (event) => {
            if (!this.mouseDown)
                return;
            this.offsetX += event.movementX / this.scale;
            this.offsetY += event.movementY / this.scale;
            this.updateOffset();
        });
        this.resizeObserver.observe(this);
        this.addEventListener("wheel", (event) => {
            const mousePos = Point(event.offsetX, event.offsetY);
            const scaleDelta = Math.pow(0.8, event.deltaY / 360);
            this.scale = scaleDelta * this.scale;
            this.updateOffset();
            return true;
        });
        this.gestureRecognizer = new TouchGestureRecognizer_1.TouchGestureRecognizer();
        this.addEventListener("touchdown", this.gestureRecognizer.processTouchDown);
        this.addEventListener("touchend", this.gestureRecognizer.processTouchEnd);
        this.addEventListener("touchcancel", this.gestureRecognizer.processTouchCancel);
        this.addEventListener("touchmove", this.gestureRecognizer.processTouchMove);
        this.gestureRecognizer.addPinchListener((center, scaleDelta, fingers) => {
        });
        this.repOk();
    }
    /**
     * Set a function that determines the color of a node.
     * @param colorFn
     */
    setNodeColoringScheme(colorFn) {
        this.nodeColorFn = colorFn;
        this.propogateSettingsToNodes();
    }
    nodeColorFn = (n) => "lightblue";
    propogateSettingsToNodes() {
        this.nodes.forEach((view, node) => {
            view.backgroundColor = this.nodeColorFn(node);
        });
    }
    /**
     * Sets if the view should show argument nodes as nodes.
     * False by default.
     * @param val
     */
    setShowArguments(val) {
        this.showArguments = true;
        this.readGraph();
        this.arrange();
        this.updateOffset();
    }
    get center() {
        return {
            x: this.offsetWidth / 2,
            y: this.offsetHeight / 2,
        };
    }
    /**
     * Follows the showArgument setting.
     * Populates this.nodes, this.edges,
     * adds the created views to the shadow dom
     * to match the graph.
     * Removes any pre-existing elements from the shadow dom.
     */
    readGraph() {
        // Clear existing
        this.nodes.forEach((view, node) => {
            this.removeChild(view);
        });
        this.nodes.clear();
        this.edges.forEach((view, edge) => {
            this.removeChild(view);
        });
        this.edges.clear();
        // Fetch nodes
        this.graph.getNodes().forEach(node => {
            if (node instanceof Expression_1.Expression) {
                const view = new ExpressionNodeView_1.ExpressionNodeView(node, this.baseNodeStyle);
                view.style.position = "absolute";
                this.nodes.set(node, view);
                this.append(view);
            }
            else if (node instanceof Argument_1.Argument) {
                if (!this.showArguments)
                    return;
                const view = new ArgumentNodeView_1.ArgumentNodeView(node, this.baseNodeStyle);
                view.style.position = "absolute";
                this.nodes.set(node, view);
                this.append(view);
            }
            else
                throw new Error("Graph contains node WebGraphView can't process.");
        });
        // Fetch edges
        GraphMinipulator_1.GraphMinipulator.dropSymmetric(this.graph.getEdges()).filter(edge => {
            // Only consider edges for which we have both endpoints on the view
            return this.nodes.has(edge.n) && this.nodes.has(edge.n1);
        }).forEach(edge => {
            const view = new EdgeView_1.EdgeView(this, edge);
            view.style.position = "absolute";
            this.edges.set(edge, view);
            this.append(view);
        });
        this.propogateSettingsToNodes();
        if (this.debugCornerEnabled) {
            const corner = document.createElement('p');
            corner.innerHTML = "Graph Nodes: " + this.graph.getNodes().size + "<br>"
                + "Visible Nodes: " + this.nodes.size + "<br>"
                + "Graph Edges: " + this.graph.getEdges().size + "<br>"
                + "Visible Edges: " + this.edges.size + "<br>";
            corner.style.zIndex = "100";
            corner.style.backgroundColor = "white";
            corner.style.width = "fit-content";
            corner.style.margin = "0";
            corner.style.padding = "1ch";
            corner.style.border = "black 1px solid";
            corner.style.position = "absolute";
            this.append(corner);
        }
        this.repOk();
    }
    connectedCallback() {
        this.readGraph();
        this.arrange();
        this.updateOffset();
    }
    /**
     * Pick places for all the nodes/edges on the screen.
     * Populates the position* rep vars.
     */
    arrange() {
        this.nodePositions.clear();
        this.edgePositions.clear();
        this.ringPositions.clear();
        this.ringElements.forEach(e => {
            this.removeChild(e);
        });
        this.ringElements.clear();
        // Place nodes on a series of rings from the center using their depth in the graph
        const levels = GraphMinipulator_1.GraphMinipulator.getLevels(this.graph, this.rootNodes, (node) => {
            if (node instanceof Expression_1.Expression)
                return true;
            else if (node instanceof Argument_1.Argument)
                return this.showArguments;
            else
                throw new Error("New type of node");
        });
        let maxDepth = 0;
        levels.forEach((_, depth) => {
            maxDepth = Math.max(maxDepth, depth);
        });
        const center = { x: (this.clientWidth / 2), y: this.clientHeight / 2 };
        let lastRadius = 0; //px
        for (let depth = 0; depth < maxDepth + 1; depth++) {
            const nodes = levels.get(depth);
            // Organize the root nodes on a circle around the center
            const stepSize = (2 * Math.PI) / nodes.size;
            // The starting angular offset to add the stepsize to
            // Making it non-zero stops things from aligning
            const stepOffset = (Math.PI / 3.5) * depth;
            /**
             * Calculating the radius of the circle
             * Suppose every root node on the starting circle requires
             * a circular space to be drawn with radius nodeRadius
             * A starting circle with n of these nodes would require a
             * circumference of n * 2nodeRadius.
             * The circumference of a circle can be expressed
             * as 2*pi*r
             * => r = n * 2 * smallR / (2 * pi)
             *      = n * smallR / pi
             */
            const nodeRadius = 70; // pixels
            let radius = Math.max(nodes.size * nodeRadius / Math.PI, lastRadius + (3 * nodeRadius));
            if (depth == 0 && nodes.size == 1)
                radius = 0;
            lastRadius = radius;
            const ns = [...nodes]; // TODO, assign a meaningful ordering
            ns.forEach((node, index) => {
                const view = this.nodes.get(node);
                //view.style.width = "" + smallR + "px"
                //view.style.height = "" + smallR + "px"
                // Get the cartesian point from the radius and angle
                const x = radius * Math.cos(stepSize * index + stepOffset) + center.x;
                const y = radius * Math.sin(stepSize * index + stepOffset) + center.y;
                this.nodePositions.set(view, Point(x, y));
            });
            const ring = document.createElement("div");
            ring.style.border = "lightgray solid 0.3ch";
            ring.style.borderRadius = "100%";
            ring.style.position = "absolute";
            ring.style.zIndex = "-10";
            this.appendChild(ring);
            this.ringElements.add(ring);
            this.ringPositions.set(ring, { radius: radius });
        }
        // Now arange the edges
        this.edges.forEach((view, edge) => {
            // Find the middle of the two endpts
            const firstX = this.nodePositions.get(this.nodes.get(edge.n)).x;
            const firstY = this.nodePositions.get(this.nodes.get(edge.n)).y;
            const secondX = this.nodePositions.get(this.nodes.get(edge.n1)).x;
            const secondY = this.nodePositions.get(this.nodes.get(edge.n1)).y;
            const x = (firstX + secondX) / 2;
            const y = (firstY + secondY) / 2;
            const angle = Math.atan2(secondY - firstY, secondX - firstX);
            this.edgePositions.set(view, { x: x, y: y, angle: angle });
        });
        this.repOk();
    }
    /**
     * Update the draw position of the nodes on the screen
     * to match the offset in rep. Assumes all views have a position
     * stored in the rep. Call arrange() first.
     * Also applies the scale factor to the final draw positions,
     * invisible to everyone else.
     */
    updateOffset() {
        const center = this.center;
        const scale = this.scale;
        function applyScale(i) {
            return Point(((i.x) - center.x) * scale + center.x, ((i.y) - center.y) * scale + center.y);
        }
        this.nodePositions.forEach((pos, view) => {
            const adjusted = applyScale({
                x: pos.x + this.offsetX,
                y: pos.y + this.offsetY,
            });
            view.style.left = "" + (adjusted.x - (0.5 * view.offsetWidth)) + "px";
            view.style.top = "" + (adjusted.y - (0.5 * view.offsetHeight)) + "px";
        });
        this.edgePositions.forEach((pos, view) => {
            view.setAngle(pos.angle);
            if (this.drawEdgeLines) {
                const firstPos = this.nodePositions.get(this.nodes.get(view.first));
                const secondPos = this.nodePositions.get(this.nodes.get(view.second));
                view.width = "" + (scale * Math.hypot(secondPos.x - firstPos.x, secondPos.y - firstPos.y)) + "px";
                view.style.borderBottom = "black 0.1ch solid";
                view.style.borderTop = "black 0.1ch solid";
            }
            else {
                view.width = "fit-content";
                view.style.borderBottom = "none";
                view.style.borderTop = "none";
            }
            const adjusted = applyScale({
                x: pos.x + this.offsetX,
                y: pos.y + this.offsetY,
            });
            view.style.left = "" + (adjusted.x - (0.5 * view.offsetWidth)) + "px";
            view.style.top = "" + (adjusted.y - (0.5 * view.offsetHeight)) + "px";
        });
        // Overlay elements change size with scale
        this.ringPositions.forEach((pos, view) => {
            const adjustedCenterPos = applyScale({
                x: center.x + this.offsetX,
                y: center.y + this.offsetY,
            });
            view.style.left = "" + (adjustedCenterPos.x - (pos.radius * scale)) + "px";
            view.style.top = "" + (adjustedCenterPos.y - (pos.radius * scale)) + "px";
            view.style.width = "" + pos.radius * 2 * scale + "px";
            view.style.aspectRatio = "1";
        });
        this.explanationPopups.forEach(val => {
            const view = val.e;
            const pos = val.pos;
            const adjusted = applyScale({
                x: pos.x + this.offsetX,
                y: pos.y + this.offsetY,
            });
            view.style.left = "" + (adjusted.x - (0.5 * view.offsetWidth)) + "px";
            view.style.top = "" + (adjusted.y - (0.5 * view.offsetHeight)) + "px";
        });
        this.repOk();
    }
    /**
     * Map from relative screen coordinates (where tl of this view is (0,0))
     * to the internal coordinate system we're using.
     */
    getInternalPos(pixelPos) {
        const center = this.center;
        const scale = this.scale;
        return Point((pixelPos.x - center.x) / scale + center.x - this.offsetX, (pixelPos.y - center.y) / scale + center.y - this.offsetY);
    }
    /**
     * React to an edge being clicked.
     * @param view In this view
     * @param event The click event
     */
    edgeClicked(view, event) {
        // TODO: Don't allow dupliate explanation popups
        if (view.edge instanceof Argument_1.Argument) {
            const popup = new ExplanationPopup_1.ExplanationPopup(view.edge, () => {
                this.removeChild(popup);
                for (let i = 0; i < this.explanationPopups.length; i++) {
                    if (this.explanationPopups[i].e === popup) {
                        this.explanationPopups.splice(i, 1);
                        break;
                    }
                }
            });
            const rect = this.getBoundingClientRect();
            const realtiveX = event.clientX - rect.left;
            const relativeY = event.clientY - rect.top;
            //TODO: The position isn't correct
            //TODO: Algorithm for picking where we should put the popup so it stays out
            // of the way of the graph
            this.explanationPopups.push({
                e: popup,
                pos: this.getInternalPos(Point(realtiveX, relativeY)),
            });
            popup.style.position = "absolute";
            this.append(popup);
            this.updateOffset();
        }
    }
    repOk() {
        (0, assert_1.assert)(this.rootNodes.size > 0);
        (0, assert_1.assert)(GraphMinipulator_1.GraphMinipulator.isConnected(this.graph), "Graph not connected");
    }
    graph;
    nodes;
    // The Position of the center of the node.
    nodePositions;
    edges;
    edgePositions;
    // Amt to add to left coordinate
    offsetX;
    // Added to top coordinate of nodes
    offsetY;
    // if the mouse is down
    mouseDown = false;
    touchDown = false;
    scale = 1;
    rootNodes;
    ringElements;
    ringPositions;
    /**
     * Position of top left of popup
     */
    explanationPopups;
    gestureRecognizer;
    // If the graph should draw argument nodes.
    showArguments = false;
    drawEdgeLines = false;
    debugCornerEnabled = false;
    resizeObserver = new ResizeObserver(_ => {
        this.arrange();
        this.updateOffset();
    });
    baseNodeStyle = (view) => {
        view.style.borderRadius = "1ch";
        view.style.backgroundColor = "lightblue";
        view.style.zIndex = "5";
    };
}
exports.WebGraphView = WebGraphView;
customElements.define("web-graphview", WebGraphView, { extends: "div" });
function Point(x, y, angle = undefined) {
    if (angle == undefined)
        return {
            x: x,
            y: y,
        };
    return {
        x: x,
        y: y,
        angle: angle,
    };
}


/***/ }),

/***/ "./src/mathlib/userinput/AntlrMathParser.ts":
/*!**************************************************!*\
  !*** ./src/mathlib/userinput/AntlrMathParser.ts ***!
  \**************************************************/
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.parseExpression = void 0;
const antlr4_1 = __importDefault(__webpack_require__(/*! antlr4 */ "./node_modules/antlr4/dist/antlr4.web.cjs"));
const { CommonTokenStream, CharStream } = antlr4_1.default;
const arithmeticLexer_1 = __importDefault(__webpack_require__(/*! ./arithmeticLexer */ "./src/mathlib/userinput/arithmeticLexer.ts"));
const arithmeticParser_1 = __importDefault(__webpack_require__(/*! ./arithmeticParser */ "./src/mathlib/userinput/arithmeticParser.ts"));
const MathVisitorImpl_1 = __webpack_require__(/*! ./MathVisitorImpl */ "./src/mathlib/userinput/MathVisitorImpl.ts");
const Flattener_1 = __webpack_require__(/*! ./Flattener */ "./src/mathlib/userinput/Flattener.ts");
/**
 * Parses the given input string to an expression.
 * @param input See the gramar file (.g4)
 * @returns
 */
function parseExpression(input) {
    const stream = new CharStream(input, true);
    const lexer = new arithmeticLexer_1.default(stream);
    const tokens = new CommonTokenStream(lexer);
    const parser = new arithmeticParser_1.default(tokens);
    //parser.buildParseTrees = true
    const tree = parser.expression();
    tree.accept(new Flattener_1.Flattener());
    // Print debug info
    //tree.accept(new PrintVisitor())
    return tree.accept(new MathVisitorImpl_1.ExpressionVisitor());
}
exports.parseExpression = parseExpression;


/***/ }),

/***/ "./src/mathlib/userinput/Flattener.ts":
/*!********************************************!*\
  !*** ./src/mathlib/userinput/Flattener.ts ***!
  \********************************************/
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Flattener = void 0;
const ConvenientExpressions_1 = __webpack_require__(/*! ../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const arithmeticParser_1 = __webpack_require__(/*! ./arithmeticParser */ "./src/mathlib/userinput/arithmeticParser.ts");
const arithmeticVisitor_1 = __importDefault(__webpack_require__(/*! ./arithmeticVisitor */ "./src/mathlib/userinput/arithmeticVisitor.ts"));
/**
 * Visitor that flattens sums and products in ASTs.
 * a + (b + c) -> a + b + c
 *
 * This only happens if b + c isn't actually surrounded
 * by parens.
 *
 *        +
 *       / \
 *      a   +
 *         / \
 *        b   c
 *
 * becomes
 *
 *       +
 *      /|\
 *     a b c
 *
 *
 */
class Flattener extends arithmeticVisitor_1.default {
    visitSum = (ctx) => {
        const flattened = this.flattenAddition(ctx);
        for (const child of flattened.children) {
            this.visit(child);
        }
        return flattened;
    };
    printChildren(ctx) {
        let result = "";
        for (const child of ctx.children) {
            result += child.getText() + "  ";
        }
        console.log(result);
        //console.log(ctx.toStringTree(null, ctx.parser!))
    }
    /**
     * If the given sum's children are also sums,
     * sets those sums parents to the ctx.
     * The given sumcontext and all its sum children
     * must have exactly 2 expression part children.
     * This prevents the mind fuck of rearranging the
     * AST on the way back out.
     */
    flattenAddition(ctx) {
        // Check if children are sums
        // Reach down and take their children
        function takeChildren(child) {
            (0, ConvenientExpressions_1.remove)(ctx.children, child);
            // Move the expression up
            if (child._right instanceof arithmeticParser_1.SumContext) {
                takeChildren(child._right);
            }
            else {
                child._right.parentCtx = ctx;
                ctx.children.unshift(child._right);
            }
            // TODO: This isn't always correct because negation of sums
            // Or is is...
            // Also look at product flattening
            // Move the operator up
            if (child.MINUS() != null) {
                child.MINUS().parentCtx = ctx;
                ctx.children.unshift(child.MINUS());
                //remove(child.children!, child.MINUS())
            }
            else {
                child.PLUS().parentCtx = ctx;
                ctx.children.unshift(child.PLUS());
                //remove(child.children!, child.PLUS())
            }
            if (child._left instanceof arithmeticParser_1.SumContext) {
                takeChildren(child._left);
            }
            else {
                child._left.parentCtx = ctx;
                ctx.children.unshift(child._left);
            }
            child.parentCtx = undefined;
        }
        if (ctx._left instanceof arithmeticParser_1.SumContext)
            takeChildren(ctx._left);
        if (ctx._right instanceof arithmeticParser_1.SumContext)
            takeChildren(ctx._right);
        return ctx;
    }
    visitProduct = (ctx) => {
        const flattened = this.flattenProduct(ctx);
        for (const child of flattened.children) {
            this.visit(child);
        }
        return flattened;
    };
    visitImplicitProduct = (ctx) => {
        const flattened = this.flattenProduct(ctx);
        for (const child of flattened.children) {
            this.visit(child);
        }
        return flattened;
    };
    flattenProduct(ctx) {
        //console.log("Flattening product " + ctx.getText() + " to")
        function instanceOfProduct(child) {
            return child instanceof arithmeticParser_1.ProductContext
                || child instanceof arithmeticParser_1.ImplicitProductContext;
        }
        // Check if children are sums
        // Reach down and take their children
        function takeChildren(child) {
            (0, ConvenientExpressions_1.remove)(ctx.children, child);
            if (instanceOfProduct(child._right)) {
                takeChildren(child._right);
            }
            else {
                child._right.parentCtx = ctx;
                ctx.children.unshift(child._right);
            }
            // Move the operator up
            if (child instanceof arithmeticParser_1.ProductContext) {
                child.TIMES().parentCtx = ctx;
                ctx.children.unshift(child.TIMES());
            }
            if (instanceOfProduct(child._left)) {
                takeChildren(child._left);
            }
            else {
                child._left.parentCtx = ctx;
                ctx.children.unshift(child._left);
            }
            child.parentCtx = undefined;
        }
        if (instanceOfProduct(ctx._left))
            takeChildren(ctx._left);
        if (instanceOfProduct(ctx._right))
            takeChildren(ctx._right);
        //console.log(ctx.getText())
        return ctx;
    }
}
exports.Flattener = Flattener;


/***/ }),

/***/ "./src/mathlib/userinput/MathVisitorImpl.ts":
/*!**************************************************!*\
  !*** ./src/mathlib/userinput/MathVisitorImpl.ts ***!
  \**************************************************/
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ExpressionVisitor = void 0;
const ConvenientExpressions_1 = __webpack_require__(/*! ../ConvenientExpressions */ "./src/mathlib/ConvenientExpressions.ts");
const Exponent_1 = __webpack_require__(/*! ../expressions/Exponent */ "./src/mathlib/expressions/Exponent.ts");
const Fraction_1 = __webpack_require__(/*! ../expressions/Fraction */ "./src/mathlib/expressions/Fraction.ts");
const Integer_1 = __webpack_require__(/*! ../expressions/Integer */ "./src/mathlib/expressions/Integer.ts");
const Integral_1 = __webpack_require__(/*! ../expressions/Integral */ "./src/mathlib/expressions/Integral.ts");
const Logarithm_1 = __webpack_require__(/*! ../expressions/Logarithm */ "./src/mathlib/expressions/Logarithm.ts");
const Product_1 = __webpack_require__(/*! ../expressions/Product */ "./src/mathlib/expressions/Product.ts");
const Sum_1 = __webpack_require__(/*! ../expressions/Sum */ "./src/mathlib/expressions/Sum.ts");
const Variable_1 = __webpack_require__(/*! ../expressions/Variable */ "./src/mathlib/expressions/Variable.ts");
const arithmeticVisitor_1 = __importDefault(__webpack_require__(/*! ./arithmeticVisitor */ "./src/mathlib/userinput/arithmeticVisitor.ts"));
/**
 * Reads out an expression.
 */
class ExpressionVisitor extends arithmeticVisitor_1.default {
    printChildren(ctx) {
        let result = "";
        for (const child of ctx.children) {
            result += child.getText() + "  ";
        }
        console.log(result);
    }
    visitExpression = (ctx) => {
        return this.visit(ctx.open());
    };
    visitEquation = (ctx) => {
        throw new Error("Can't parse equations with this visitor");
    };
    visitPower = (ctx) => {
        //console.log("Power")
        //this.printChildren(ctx)
        //console.log(ctx._left.getText())
        //console.log(ctx._right.getText())
        return Exponent_1.Exponent.of(this.visit(ctx._left), this.visit(ctx._right));
    };
    visitParen = (ctx) => {
        return this.visit(ctx.open());
    };
    visitDivision = (ctx) => {
        return Fraction_1.Fraction.of(this.visit(ctx._left), this.visit(ctx._right));
    };
    visitProduct = (ctx) => {
        return Product_1.Product.of([
            ...ctx.closed_list().map(exp => this.visit(exp))
        ]);
    };
    visitImplicitProduct = (ctx) => {
        //console.log("Implicit product of context")
        //this.printChildren(ctx)
        return Product_1.Product.of([
            this.visit(ctx._left),
            this.visit(ctx._right)
        ]);
    };
    visitRight_ClosedImplicitProduct = (ctx) => {
        //console.log("Right closed implicit product of context")
        //this.printChildren(ctx)
        return Product_1.Product.of([
            this.visit(ctx._left),
            this.visit(ctx._right)
        ]);
    };
    visitIntegral = (ctx) => {
        return Integral_1.Integral.of(this.visit(ctx._integrand), Variable_1.Variable.of('x'));
    };
    visitLog = (ctx) => {
        return Logarithm_1.Logarithm.of(this.visit(ctx._content), ctx._base == undefined ? Integer_1.Integer.of(10) : this.visit(ctx._base));
    };
    // visitUnaryOnAtom = (ctx: UnaryOnAtomContext): Expression => {
    //     const isPositive = ctx.MINUS_list.length % 2 == 0
    //     if (isPositive)
    //         return this.visit(ctx.atom())
    //     return negative(this.visit(ctx.atom()))
    // }
    visitUnaryOnExpression = (ctx) => {
        const isPositive = ctx.MINUS() == null;
        if (isPositive)
            return this.visit(ctx.closed());
        return (0, ConvenientExpressions_1.negative)(this.visit(ctx.closed()));
    };
    visitSum = (ctx) => {
        // console.log("Visiting sum with " + ctx.children!.length + " children: " + ctx.toStringTree(null, ctx.parser!))
        // this.printChildren(ctx)
        // Sum of plus and minus components
        const terms = [this.visit(ctx.children[0])];
        for (let i = 1; i < ctx.children.length; i += 2) {
            if (ctx.children[i].getText() == '-')
                terms.push((0, ConvenientExpressions_1.negative)(this.visit(ctx.children[i + 1])));
            else {
                terms.push(this.visit(ctx.children[i + 1]));
            }
        }
        //console.log("Printing made terms")
        for (const term of terms) {
            //console.log("  " + term.toString())
        }
        //console.log("done")
        return Sum_1.Sum.of(terms);
    };
    // visitExpression = (ctx: ExpressionContext): Expression => {
    //     // Guess what expression type it is, following pemdas
    //     if ((ctx.PLUS(0) != null || ctx.MINUS(0) != null) 
    //             && (ctx.expression_list().length ?? 0) > 1) {
    //     } else {
    //         console.log("Unknown expression type")
    //         for (const key of Object.keys(ctx)) {
    //             console.log(`${key}: ${(ctx as any)[key]}`)
    //         }
    //         for (const key of Object.getOwnPropertyNames(ctx)) {
    //             console.log(`${key}: ${(ctx as any)[key]}`)
    //         }
    //         console.log("Expressions: " + ctx.expression_list().length)
    //         console.log("Num children: " + ctx.children!.length)
    //         if (ctx.children?.length ?? 0 > 0)
    //             for (const child of ctx.children!) {
    //                 console.log("Child: " + child.getText())
    //             }
    //         throw new Error("Not implemented 1")
    //     }
    // };
    visitAtom = (ctx) => {
        if (ctx.VARIABLE() != null) {
            return Variable_1.Variable.of(ctx.VARIABLE().getText());
        }
        else if (ctx.SCIENTIFIC_NUMBER() != null) {
            return Integer_1.Integer.of(Number.parseFloat(ctx.SCIENTIFIC_NUMBER().getText()));
        }
        else {
            throw new Error("Not implemented");
        }
    };
    visitClosedAtom = (ctx) => {
        return this.visit(ctx.atom());
    };
    visitClosedIsRight_Closed = (ctx) => {
        return this.visit(ctx.closed());
    };
    visitRight_ClosedIsOpen = (ctx) => {
        return this.visit(ctx.right_closed());
    };
    visitRelop = (ctx) => {
        throw new Error("Shouldn't happen with this visitor impl");
    };
}
exports.ExpressionVisitor = ExpressionVisitor;


/***/ }),

/***/ "./src/mathlib/userinput/arithmeticLexer.ts":
/*!**************************************************!*\
  !*** ./src/mathlib/userinput/arithmeticLexer.ts ***!
  \**************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
// Generated from ./src/mathlib/userinput/arithmetic.g4 by ANTLR 4.13.0
// noinspection ES6UnusedImports,JSUnusedGlobalSymbols,JSUnusedLocalSymbols
const antlr4_1 = __webpack_require__(/*! antlr4 */ "./node_modules/antlr4/dist/antlr4.web.cjs");
class arithmeticLexer extends antlr4_1.Lexer {
    static SCIENTIFIC_NUMBER = 1;
    static LPAREN = 2;
    static RPAREN = 3;
    static PLUS = 4;
    static MINUS = 5;
    static TIMES = 6;
    static DIV = 7;
    static GT = 8;
    static LT = 9;
    static EQ = 10;
    static POINT = 11;
    static POW = 12;
    static INT = 13;
    static LOG = 14;
    static VARIABLE = 15;
    static WS = 16;
    static EOF = antlr4_1.Token.EOF;
    static channelNames = ["DEFAULT_TOKEN_CHANNEL", "HIDDEN"];
    static literalNames = [null, null,
        "'('", "')'",
        "'+'", "'-'",
        null, "'/'",
        "'>'", "'<'",
        "'='", "'.'",
        "'^'"];
    static symbolicNames = [null, "SCIENTIFIC_NUMBER",
        "LPAREN", "RPAREN",
        "PLUS", "MINUS",
        "TIMES", "DIV",
        "GT", "LT",
        "EQ", "POINT",
        "POW", "INT",
        "LOG", "VARIABLE",
        "WS"];
    static modeNames = ["DEFAULT_MODE",];
    static ruleNames = [
        "SCIENTIFIC_NUMBER", "NUMBER", "UNSIGNED_INTEGER", "E", "L", "O", "G",
        "SIGN", "LPAREN", "RPAREN", "PLUS", "MINUS", "TIMES", "DIV", "GT", "LT",
        "EQ", "POINT", "POW", "INT", "LOG", "VARIABLE", "WS",
    ];
    constructor(input) {
        super(input);
        this._interp = new antlr4_1.LexerATNSimulator(this, arithmeticLexer._ATN, arithmeticLexer.DecisionsToDFA, new antlr4_1.PredictionContextCache());
    }
    get grammarFileName() { return "arithmetic.g4"; }
    get literalNames() { return arithmeticLexer.literalNames; }
    get symbolicNames() { return arithmeticLexer.symbolicNames; }
    get ruleNames() { return arithmeticLexer.ruleNames; }
    get serializedATN() { return arithmeticLexer._serializedATN; }
    get channelNames() { return arithmeticLexer.channelNames; }
    get modeNames() { return arithmeticLexer.modeNames; }
    static _serializedATN = [4, 0, 16, 123, 6, -1, 2, 0,
        7, 0, 2, 1, 7, 1, 2, 2, 7, 2, 2, 3, 7, 3, 2, 4, 7, 4, 2, 5, 7, 5, 2, 6, 7, 6, 2, 7, 7, 7, 2, 8, 7, 8, 2, 9,
        7, 9, 2, 10, 7, 10, 2, 11, 7, 11, 2, 12, 7, 12, 2, 13, 7, 13, 2, 14, 7, 14, 2, 15, 7, 15, 2, 16, 7,
        16, 2, 17, 7, 17, 2, 18, 7, 18, 2, 19, 7, 19, 2, 20, 7, 20, 2, 21, 7, 21, 2, 22, 7, 22, 1, 0, 1, 0,
        1, 0, 3, 0, 51, 8, 0, 1, 0, 1, 0, 3, 0, 55, 8, 0, 1, 1, 4, 1, 58, 8, 1, 11, 1, 12, 1, 59, 1, 1, 1, 1, 4,
        1, 64, 8, 1, 11, 1, 12, 1, 65, 3, 1, 68, 8, 1, 1, 2, 4, 2, 71, 8, 2, 11, 2, 12, 2, 72, 1, 3, 1, 3, 1,
        4, 1, 4, 1, 5, 1, 5, 1, 6, 1, 6, 1, 7, 1, 7, 1, 8, 1, 8, 1, 9, 1, 9, 1, 10, 1, 10, 1, 11, 1, 11, 1, 12,
        1, 12, 1, 13, 1, 13, 1, 14, 1, 14, 1, 15, 1, 15, 1, 16, 1, 16, 1, 17, 1, 17, 1, 18, 1, 18, 1, 19, 1,
        19, 1, 19, 1, 19, 1, 20, 1, 20, 1, 20, 1, 20, 1, 21, 1, 21, 1, 22, 4, 22, 118, 8, 22, 11, 22, 12,
        22, 119, 1, 22, 1, 22, 0, 0, 23, 1, 1, 3, 0, 5, 0, 7, 0, 9, 0, 11, 0, 13, 0, 15, 0, 17, 2, 19, 3, 21,
        4, 23, 5, 25, 6, 27, 7, 29, 8, 31, 9, 33, 10, 35, 11, 37, 12, 39, 13, 41, 14, 43, 15, 45, 16, 1,
        0, 11, 2, 0, 69, 69, 101, 101, 2, 0, 76, 76, 108, 108, 2, 0, 79, 79, 111, 111, 2, 0, 71, 71, 103,
        103, 2, 0, 43, 43, 45, 45, 2, 0, 42, 42, 183, 183, 2, 0, 73, 73, 105, 105, 2, 0, 78, 78, 110, 110,
        2, 0, 84, 84, 116, 116, 2, 0, 65, 90, 97, 122, 3, 0, 9, 10, 13, 13, 32, 32, 122, 0, 1, 1, 0, 0, 0,
        0, 17, 1, 0, 0, 0, 0, 19, 1, 0, 0, 0, 0, 21, 1, 0, 0, 0, 0, 23, 1, 0, 0, 0, 0, 25, 1, 0, 0, 0, 0, 27, 1,
        0, 0, 0, 0, 29, 1, 0, 0, 0, 0, 31, 1, 0, 0, 0, 0, 33, 1, 0, 0, 0, 0, 35, 1, 0, 0, 0, 0, 37, 1, 0, 0, 0,
        0, 39, 1, 0, 0, 0, 0, 41, 1, 0, 0, 0, 0, 43, 1, 0, 0, 0, 0, 45, 1, 0, 0, 0, 1, 47, 1, 0, 0, 0, 3, 57, 1,
        0, 0, 0, 5, 70, 1, 0, 0, 0, 7, 74, 1, 0, 0, 0, 9, 76, 1, 0, 0, 0, 11, 78, 1, 0, 0, 0, 13, 80, 1, 0, 0,
        0, 15, 82, 1, 0, 0, 0, 17, 84, 1, 0, 0, 0, 19, 86, 1, 0, 0, 0, 21, 88, 1, 0, 0, 0, 23, 90, 1, 0, 0, 0,
        25, 92, 1, 0, 0, 0, 27, 94, 1, 0, 0, 0, 29, 96, 1, 0, 0, 0, 31, 98, 1, 0, 0, 0, 33, 100, 1, 0, 0, 0,
        35, 102, 1, 0, 0, 0, 37, 104, 1, 0, 0, 0, 39, 106, 1, 0, 0, 0, 41, 110, 1, 0, 0, 0, 43, 114, 1, 0,
        0, 0, 45, 117, 1, 0, 0, 0, 47, 54, 3, 3, 1, 0, 48, 50, 3, 7, 3, 0, 49, 51, 3, 15, 7, 0, 50, 49, 1, 0,
        0, 0, 50, 51, 1, 0, 0, 0, 51, 52, 1, 0, 0, 0, 52, 53, 3, 5, 2, 0, 53, 55, 1, 0, 0, 0, 54, 48, 1, 0, 0,
        0, 54, 55, 1, 0, 0, 0, 55, 2, 1, 0, 0, 0, 56, 58, 2, 48, 57, 0, 57, 56, 1, 0, 0, 0, 58, 59, 1, 0, 0,
        0, 59, 57, 1, 0, 0, 0, 59, 60, 1, 0, 0, 0, 60, 67, 1, 0, 0, 0, 61, 63, 5, 46, 0, 0, 62, 64, 2, 48, 57,
        0, 63, 62, 1, 0, 0, 0, 64, 65, 1, 0, 0, 0, 65, 63, 1, 0, 0, 0, 65, 66, 1, 0, 0, 0, 66, 68, 1, 0, 0, 0,
        67, 61, 1, 0, 0, 0, 67, 68, 1, 0, 0, 0, 68, 4, 1, 0, 0, 0, 69, 71, 2, 48, 57, 0, 70, 69, 1, 0, 0, 0,
        71, 72, 1, 0, 0, 0, 72, 70, 1, 0, 0, 0, 72, 73, 1, 0, 0, 0, 73, 6, 1, 0, 0, 0, 74, 75, 7, 0, 0, 0, 75,
        8, 1, 0, 0, 0, 76, 77, 7, 1, 0, 0, 77, 10, 1, 0, 0, 0, 78, 79, 7, 2, 0, 0, 79, 12, 1, 0, 0, 0, 80, 81,
        7, 3, 0, 0, 81, 14, 1, 0, 0, 0, 82, 83, 7, 4, 0, 0, 83, 16, 1, 0, 0, 0, 84, 85, 5, 40, 0, 0, 85, 18,
        1, 0, 0, 0, 86, 87, 5, 41, 0, 0, 87, 20, 1, 0, 0, 0, 88, 89, 5, 43, 0, 0, 89, 22, 1, 0, 0, 0, 90, 91,
        5, 45, 0, 0, 91, 24, 1, 0, 0, 0, 92, 93, 7, 5, 0, 0, 93, 26, 1, 0, 0, 0, 94, 95, 5, 47, 0, 0, 95, 28,
        1, 0, 0, 0, 96, 97, 5, 62, 0, 0, 97, 30, 1, 0, 0, 0, 98, 99, 5, 60, 0, 0, 99, 32, 1, 0, 0, 0, 100, 101,
        5, 61, 0, 0, 101, 34, 1, 0, 0, 0, 102, 103, 5, 46, 0, 0, 103, 36, 1, 0, 0, 0, 104, 105, 5, 94, 0,
        0, 105, 38, 1, 0, 0, 0, 106, 107, 7, 6, 0, 0, 107, 108, 7, 7, 0, 0, 108, 109, 7, 8, 0, 0, 109, 40,
        1, 0, 0, 0, 110, 111, 3, 9, 4, 0, 111, 112, 3, 11, 5, 0, 112, 113, 3, 13, 6, 0, 113, 42, 1, 0, 0,
        0, 114, 115, 7, 9, 0, 0, 115, 44, 1, 0, 0, 0, 116, 118, 7, 10, 0, 0, 117, 116, 1, 0, 0, 0, 118, 119,
        1, 0, 0, 0, 119, 117, 1, 0, 0, 0, 119, 120, 1, 0, 0, 0, 120, 121, 1, 0, 0, 0, 121, 122, 6, 22, 0,
        0, 122, 46, 1, 0, 0, 0, 8, 0, 50, 54, 59, 65, 67, 72, 119, 1, 6, 0, 0];
    static __ATN;
    static get _ATN() {
        if (!arithmeticLexer.__ATN) {
            arithmeticLexer.__ATN = new antlr4_1.ATNDeserializer().deserialize(arithmeticLexer._serializedATN);
        }
        return arithmeticLexer.__ATN;
    }
    static DecisionsToDFA = arithmeticLexer._ATN.decisionToState.map((ds, index) => new antlr4_1.DFA(ds, index));
}
exports["default"] = arithmeticLexer;


/***/ }),

/***/ "./src/mathlib/userinput/arithmeticParser.ts":
/*!***************************************************!*\
  !*** ./src/mathlib/userinput/arithmeticParser.ts ***!
  \***************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

// Generated from ./src/mathlib/userinput/arithmetic.g4 by ANTLR 4.13.0
// noinspection ES6UnusedImports,JSUnusedGlobalSymbols,JSUnusedLocalSymbols
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.RelopContext = exports.AtomContext = exports.SumContext = exports.IntegralContext = exports.Right_ClosedIsOpenContext = exports.OpenContext = exports.Right_ClosedImplicitProductContext = exports.ClosedIsRight_ClosedContext = exports.UnaryOnExpressionContext = exports.Right_closedContext = exports.ParenContext = exports.PowerContext = exports.ClosedAtomContext = exports.DivisionContext = exports.ProductContext = exports.LogContext = exports.ImplicitProductContext = exports.ClosedContext = exports.ExpressionContext = exports.EquationContext = void 0;
const antlr4_1 = __webpack_require__(/*! antlr4 */ "./node_modules/antlr4/dist/antlr4.web.cjs");
class arithmeticParser extends antlr4_1.Parser {
    static SCIENTIFIC_NUMBER = 1;
    static LPAREN = 2;
    static RPAREN = 3;
    static PLUS = 4;
    static MINUS = 5;
    static TIMES = 6;
    static DIV = 7;
    static GT = 8;
    static LT = 9;
    static EQ = 10;
    static POINT = 11;
    static POW = 12;
    static INT = 13;
    static LOG = 14;
    static VARIABLE = 15;
    static WS = 16;
    static EOF = antlr4_1.Token.EOF;
    static RULE_equation = 0;
    static RULE_expression = 1;
    static RULE_closed = 2;
    static RULE_right_closed = 3;
    static RULE_open = 4;
    static RULE_atom = 5;
    static RULE_relop = 6;
    static literalNames = [null, null,
        "'('", "')'",
        "'+'", "'-'",
        null, "'/'",
        "'>'", "'<'",
        "'='", "'.'",
        "'^'"];
    static symbolicNames = [null, "SCIENTIFIC_NUMBER",
        "LPAREN", "RPAREN",
        "PLUS", "MINUS",
        "TIMES", "DIV",
        "GT", "LT",
        "EQ", "POINT",
        "POW", "INT",
        "LOG", "VARIABLE",
        "WS"];
    // tslint:disable:no-trailing-whitespace
    static ruleNames = [
        "equation", "expression", "closed", "right_closed", "open", "atom", "relop",
    ];
    get grammarFileName() { return "arithmetic.g4"; }
    get literalNames() { return arithmeticParser.literalNames; }
    get symbolicNames() { return arithmeticParser.symbolicNames; }
    get ruleNames() { return arithmeticParser.ruleNames; }
    get serializedATN() { return arithmeticParser._serializedATN; }
    createFailedPredicateException(predicate, message) {
        return new antlr4_1.FailedPredicateException(this, predicate, message);
    }
    constructor(input) {
        super(input);
        this._interp = new antlr4_1.ParserATNSimulator(this, arithmeticParser._ATN, arithmeticParser.DecisionsToDFA, new antlr4_1.PredictionContextCache());
    }
    // @RuleVersion(0)
    equation() {
        let localctx = new EquationContext(this, this._ctx, this.state);
        this.enterRule(localctx, 0, arithmeticParser.RULE_equation);
        try {
            this.enterOuterAlt(localctx, 1);
            {
                this.state = 14;
                this.expression();
                this.state = 15;
                this.relop();
                this.state = 16;
                this.expression();
            }
        }
        catch (re) {
            if (re instanceof antlr4_1.RecognitionException) {
                localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            }
            else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localctx;
    }
    // @RuleVersion(0)
    expression() {
        let localctx = new ExpressionContext(this, this._ctx, this.state);
        this.enterRule(localctx, 2, arithmeticParser.RULE_expression);
        try {
            this.enterOuterAlt(localctx, 1);
            {
                this.state = 18;
                this.open(0);
            }
        }
        catch (re) {
            if (re instanceof antlr4_1.RecognitionException) {
                localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            }
            else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localctx;
    }
    // @RuleVersion(0)
    closed(_p) {
        if (_p === undefined) {
            _p = 0;
        }
        let _parentctx = this._ctx;
        let _parentState = this.state;
        let localctx = new ClosedContext(this, this._ctx, _parentState);
        let _prevctx = localctx;
        let _startState = 4;
        this.enterRecursionRule(localctx, 4, arithmeticParser.RULE_closed, _p);
        try {
            let _alt;
            this.enterOuterAlt(localctx, 1);
            {
                this.state = 31;
                this._errHandler.sync(this);
                switch (this._input.LA(1)) {
                    case 2:
                        {
                            localctx = new ParenContext(this, localctx);
                            this._ctx = localctx;
                            _prevctx = localctx;
                            this.state = 21;
                            this.match(arithmeticParser.LPAREN);
                            this.state = 22;
                            this.open(0);
                            this.state = 23;
                            this.match(arithmeticParser.RPAREN);
                        }
                        break;
                    case 1:
                    case 15:
                        {
                            localctx = new ClosedAtomContext(this, localctx);
                            this._ctx = localctx;
                            _prevctx = localctx;
                            this.state = 25;
                            this.atom();
                        }
                        break;
                    case 14:
                        {
                            localctx = new LogContext(this, localctx);
                            this._ctx = localctx;
                            _prevctx = localctx;
                            this.state = 26;
                            this.match(arithmeticParser.LOG);
                            this.state = 28;
                            this._errHandler.sync(this);
                            switch (this._interp.adaptivePredict(this._input, 0, this._ctx)) {
                                case 1:
                                    {
                                        this.state = 27;
                                        localctx._base = this.closed(0);
                                    }
                                    break;
                            }
                            this.state = 30;
                            localctx._content = this.closed(1);
                        }
                        break;
                    default:
                        throw new antlr4_1.NoViableAltException(this);
                }
                this._ctx.stop = this._input.LT(-1);
                this.state = 46;
                this._errHandler.sync(this);
                _alt = this._interp.adaptivePredict(this._input, 3, this._ctx);
                while (_alt !== 2 && _alt !== antlr4_1.ATN.INVALID_ALT_NUMBER) {
                    if (_alt === 1) {
                        if (this._parseListeners != null) {
                            this.triggerExitRuleEvent();
                        }
                        _prevctx = localctx;
                        {
                            this.state = 44;
                            this._errHandler.sync(this);
                            switch (this._interp.adaptivePredict(this._input, 2, this._ctx)) {
                                case 1:
                                    {
                                        localctx = new DivisionContext(this, new ClosedContext(this, _parentctx, _parentState));
                                        localctx._left = _prevctx;
                                        this.pushNewRecursionContext(localctx, _startState, arithmeticParser.RULE_closed);
                                        this.state = 33;
                                        if (!(this.precpred(this._ctx, 5))) {
                                            throw this.createFailedPredicateException("this.precpred(this._ctx, 5)");
                                        }
                                        this.state = 34;
                                        this.match(arithmeticParser.DIV);
                                        this.state = 35;
                                        localctx._right = this.closed(6);
                                    }
                                    break;
                                case 2:
                                    {
                                        localctx = new PowerContext(this, new ClosedContext(this, _parentctx, _parentState));
                                        localctx._left = _prevctx;
                                        this.pushNewRecursionContext(localctx, _startState, arithmeticParser.RULE_closed);
                                        this.state = 36;
                                        if (!(this.precpred(this._ctx, 4))) {
                                            throw this.createFailedPredicateException("this.precpred(this._ctx, 4)");
                                        }
                                        this.state = 37;
                                        this.match(arithmeticParser.POW);
                                        this.state = 38;
                                        localctx._right = this.closed(5);
                                    }
                                    break;
                                case 3:
                                    {
                                        localctx = new ProductContext(this, new ClosedContext(this, _parentctx, _parentState));
                                        localctx._left = _prevctx;
                                        this.pushNewRecursionContext(localctx, _startState, arithmeticParser.RULE_closed);
                                        this.state = 39;
                                        if (!(this.precpred(this._ctx, 3))) {
                                            throw this.createFailedPredicateException("this.precpred(this._ctx, 3)");
                                        }
                                        this.state = 40;
                                        this.match(arithmeticParser.TIMES);
                                        this.state = 41;
                                        localctx._right = this.closed(4);
                                    }
                                    break;
                                case 4:
                                    {
                                        localctx = new ImplicitProductContext(this, new ClosedContext(this, _parentctx, _parentState));
                                        localctx._left = _prevctx;
                                        this.pushNewRecursionContext(localctx, _startState, arithmeticParser.RULE_closed);
                                        this.state = 42;
                                        if (!(this.precpred(this._ctx, 2))) {
                                            throw this.createFailedPredicateException("this.precpred(this._ctx, 2)");
                                        }
                                        this.state = 43;
                                        localctx._right = this.closed(3);
                                    }
                                    break;
                            }
                        }
                    }
                    this.state = 48;
                    this._errHandler.sync(this);
                    _alt = this._interp.adaptivePredict(this._input, 3, this._ctx);
                }
            }
        }
        catch (re) {
            if (re instanceof antlr4_1.RecognitionException) {
                localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            }
            else {
                throw re;
            }
        }
        finally {
            this.unrollRecursionContexts(_parentctx);
        }
        return localctx;
    }
    // @RuleVersion(0)
    right_closed(_p) {
        if (_p === undefined) {
            _p = 0;
        }
        let _parentctx = this._ctx;
        let _parentState = this.state;
        let localctx = new Right_closedContext(this, this._ctx, _parentState);
        let _prevctx = localctx;
        let _startState = 6;
        this.enterRecursionRule(localctx, 6, arithmeticParser.RULE_right_closed, _p);
        let _la;
        try {
            let _alt;
            this.enterOuterAlt(localctx, 1);
            {
                this.state = 53;
                this._errHandler.sync(this);
                switch (this._input.LA(1)) {
                    case 1:
                    case 2:
                    case 14:
                    case 15:
                        {
                            localctx = new ClosedIsRight_ClosedContext(this, localctx);
                            this._ctx = localctx;
                            _prevctx = localctx;
                            this.state = 50;
                            this.closed(0);
                        }
                        break;
                    case 4:
                    case 5:
                        {
                            localctx = new UnaryOnExpressionContext(this, localctx);
                            this._ctx = localctx;
                            _prevctx = localctx;
                            this.state = 51;
                            _la = this._input.LA(1);
                            if (!(_la === 4 || _la === 5)) {
                                this._errHandler.recoverInline(this);
                            }
                            else {
                                this._errHandler.reportMatch(this);
                                this.consume();
                            }
                            this.state = 52;
                            this.closed(0);
                        }
                        break;
                    default:
                        throw new antlr4_1.NoViableAltException(this);
                }
                this._ctx.stop = this._input.LT(-1);
                this.state = 59;
                this._errHandler.sync(this);
                _alt = this._interp.adaptivePredict(this._input, 5, this._ctx);
                while (_alt !== 2 && _alt !== antlr4_1.ATN.INVALID_ALT_NUMBER) {
                    if (_alt === 1) {
                        if (this._parseListeners != null) {
                            this.triggerExitRuleEvent();
                        }
                        _prevctx = localctx;
                        {
                            {
                                localctx = new Right_ClosedImplicitProductContext(this, new Right_closedContext(this, _parentctx, _parentState));
                                localctx._left = _prevctx;
                                this.pushNewRecursionContext(localctx, _startState, arithmeticParser.RULE_right_closed);
                                this.state = 55;
                                if (!(this.precpred(this._ctx, 1))) {
                                    throw this.createFailedPredicateException("this.precpred(this._ctx, 1)");
                                }
                                this.state = 56;
                                localctx._right = this.closed(0);
                            }
                        }
                    }
                    this.state = 61;
                    this._errHandler.sync(this);
                    _alt = this._interp.adaptivePredict(this._input, 5, this._ctx);
                }
            }
        }
        catch (re) {
            if (re instanceof antlr4_1.RecognitionException) {
                localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            }
            else {
                throw re;
            }
        }
        finally {
            this.unrollRecursionContexts(_parentctx);
        }
        return localctx;
    }
    // @RuleVersion(0)
    open(_p) {
        if (_p === undefined) {
            _p = 0;
        }
        let _parentctx = this._ctx;
        let _parentState = this.state;
        let localctx = new OpenContext(this, this._ctx, _parentState);
        let _prevctx = localctx;
        let _startState = 8;
        this.enterRecursionRule(localctx, 8, arithmeticParser.RULE_open, _p);
        let _la;
        try {
            let _alt;
            this.enterOuterAlt(localctx, 1);
            {
                this.state = 66;
                this._errHandler.sync(this);
                switch (this._input.LA(1)) {
                    case 1:
                    case 2:
                    case 4:
                    case 5:
                    case 14:
                    case 15:
                        {
                            localctx = new Right_ClosedIsOpenContext(this, localctx);
                            this._ctx = localctx;
                            _prevctx = localctx;
                            this.state = 63;
                            this.right_closed(0);
                        }
                        break;
                    case 13:
                        {
                            localctx = new IntegralContext(this, localctx);
                            this._ctx = localctx;
                            _prevctx = localctx;
                            this.state = 64;
                            this.match(arithmeticParser.INT);
                            this.state = 65;
                            localctx._integrand = this.closed(0);
                        }
                        break;
                    default:
                        throw new antlr4_1.NoViableAltException(this);
                }
                this._ctx.stop = this._input.LT(-1);
                this.state = 73;
                this._errHandler.sync(this);
                _alt = this._interp.adaptivePredict(this._input, 7, this._ctx);
                while (_alt !== 2 && _alt !== antlr4_1.ATN.INVALID_ALT_NUMBER) {
                    if (_alt === 1) {
                        if (this._parseListeners != null) {
                            this.triggerExitRuleEvent();
                        }
                        _prevctx = localctx;
                        {
                            {
                                localctx = new SumContext(this, new OpenContext(this, _parentctx, _parentState));
                                localctx._left = _prevctx;
                                this.pushNewRecursionContext(localctx, _startState, arithmeticParser.RULE_open);
                                this.state = 68;
                                if (!(this.precpred(this._ctx, 2))) {
                                    throw this.createFailedPredicateException("this.precpred(this._ctx, 2)");
                                }
                                this.state = 69;
                                _la = this._input.LA(1);
                                if (!(_la === 4 || _la === 5)) {
                                    this._errHandler.recoverInline(this);
                                }
                                else {
                                    this._errHandler.reportMatch(this);
                                    this.consume();
                                }
                                this.state = 70;
                                localctx._right = this.right_closed(0);
                            }
                        }
                    }
                    this.state = 75;
                    this._errHandler.sync(this);
                    _alt = this._interp.adaptivePredict(this._input, 7, this._ctx);
                }
            }
        }
        catch (re) {
            if (re instanceof antlr4_1.RecognitionException) {
                localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            }
            else {
                throw re;
            }
        }
        finally {
            this.unrollRecursionContexts(_parentctx);
        }
        return localctx;
    }
    // @RuleVersion(0)
    atom() {
        let localctx = new AtomContext(this, this._ctx, this.state);
        this.enterRule(localctx, 10, arithmeticParser.RULE_atom);
        let _la;
        try {
            this.enterOuterAlt(localctx, 1);
            {
                this.state = 76;
                _la = this._input.LA(1);
                if (!(_la === 1 || _la === 15)) {
                    this._errHandler.recoverInline(this);
                }
                else {
                    this._errHandler.reportMatch(this);
                    this.consume();
                }
            }
        }
        catch (re) {
            if (re instanceof antlr4_1.RecognitionException) {
                localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            }
            else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localctx;
    }
    // @RuleVersion(0)
    relop() {
        let localctx = new RelopContext(this, this._ctx, this.state);
        this.enterRule(localctx, 12, arithmeticParser.RULE_relop);
        try {
            this.enterOuterAlt(localctx, 1);
            {
                this.state = 78;
                this.match(arithmeticParser.EQ);
            }
        }
        catch (re) {
            if (re instanceof antlr4_1.RecognitionException) {
                localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            }
            else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localctx;
    }
    sempred(localctx, ruleIndex, predIndex) {
        switch (ruleIndex) {
            case 2:
                return this.closed_sempred(localctx, predIndex);
            case 3:
                return this.right_closed_sempred(localctx, predIndex);
            case 4:
                return this.open_sempred(localctx, predIndex);
        }
        return true;
    }
    closed_sempred(localctx, predIndex) {
        switch (predIndex) {
            case 0:
                return this.precpred(this._ctx, 5);
            case 1:
                return this.precpred(this._ctx, 4);
            case 2:
                return this.precpred(this._ctx, 3);
            case 3:
                return this.precpred(this._ctx, 2);
        }
        return true;
    }
    right_closed_sempred(localctx, predIndex) {
        switch (predIndex) {
            case 4:
                return this.precpred(this._ctx, 1);
        }
        return true;
    }
    open_sempred(localctx, predIndex) {
        switch (predIndex) {
            case 5:
                return this.precpred(this._ctx, 2);
        }
        return true;
    }
    static _serializedATN = [4, 1, 16, 81, 2, 0, 7, 0, 2,
        1, 7, 1, 2, 2, 7, 2, 2, 3, 7, 3, 2, 4, 7, 4, 2, 5, 7, 5, 2, 6, 7, 6, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1,
        2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 3, 2, 29, 8, 2, 1, 2, 3, 2, 32, 8, 2, 1, 2, 1, 2, 1, 2, 1, 2,
        1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 5, 2, 45, 8, 2, 10, 2, 12, 2, 48, 9, 2, 1, 3, 1, 3, 1, 3, 1, 3,
        3, 3, 54, 8, 3, 1, 3, 1, 3, 5, 3, 58, 8, 3, 10, 3, 12, 3, 61, 9, 3, 1, 4, 1, 4, 1, 4, 1, 4, 3, 4, 67, 8,
        4, 1, 4, 1, 4, 1, 4, 5, 4, 72, 8, 4, 10, 4, 12, 4, 75, 9, 4, 1, 5, 1, 5, 1, 6, 1, 6, 1, 6, 0, 3, 4, 6, 8,
        7, 0, 2, 4, 6, 8, 10, 12, 0, 2, 1, 0, 4, 5, 2, 0, 1, 1, 15, 15, 84, 0, 14, 1, 0, 0, 0, 2, 18, 1, 0, 0,
        0, 4, 31, 1, 0, 0, 0, 6, 53, 1, 0, 0, 0, 8, 66, 1, 0, 0, 0, 10, 76, 1, 0, 0, 0, 12, 78, 1, 0, 0, 0, 14,
        15, 3, 2, 1, 0, 15, 16, 3, 12, 6, 0, 16, 17, 3, 2, 1, 0, 17, 1, 1, 0, 0, 0, 18, 19, 3, 8, 4, 0, 19, 3,
        1, 0, 0, 0, 20, 21, 6, 2, -1, 0, 21, 22, 5, 2, 0, 0, 22, 23, 3, 8, 4, 0, 23, 24, 5, 3, 0, 0, 24, 32,
        1, 0, 0, 0, 25, 32, 3, 10, 5, 0, 26, 28, 5, 14, 0, 0, 27, 29, 3, 4, 2, 0, 28, 27, 1, 0, 0, 0, 28, 29,
        1, 0, 0, 0, 29, 30, 1, 0, 0, 0, 30, 32, 3, 4, 2, 1, 31, 20, 1, 0, 0, 0, 31, 25, 1, 0, 0, 0, 31, 26, 1,
        0, 0, 0, 32, 46, 1, 0, 0, 0, 33, 34, 10, 5, 0, 0, 34, 35, 5, 7, 0, 0, 35, 45, 3, 4, 2, 6, 36, 37, 10,
        4, 0, 0, 37, 38, 5, 12, 0, 0, 38, 45, 3, 4, 2, 5, 39, 40, 10, 3, 0, 0, 40, 41, 5, 6, 0, 0, 41, 45, 3,
        4, 2, 4, 42, 43, 10, 2, 0, 0, 43, 45, 3, 4, 2, 3, 44, 33, 1, 0, 0, 0, 44, 36, 1, 0, 0, 0, 44, 39, 1,
        0, 0, 0, 44, 42, 1, 0, 0, 0, 45, 48, 1, 0, 0, 0, 46, 44, 1, 0, 0, 0, 46, 47, 1, 0, 0, 0, 47, 5, 1, 0,
        0, 0, 48, 46, 1, 0, 0, 0, 49, 50, 6, 3, -1, 0, 50, 54, 3, 4, 2, 0, 51, 52, 7, 0, 0, 0, 52, 54, 3, 4,
        2, 0, 53, 49, 1, 0, 0, 0, 53, 51, 1, 0, 0, 0, 54, 59, 1, 0, 0, 0, 55, 56, 10, 1, 0, 0, 56, 58, 3, 4,
        2, 0, 57, 55, 1, 0, 0, 0, 58, 61, 1, 0, 0, 0, 59, 57, 1, 0, 0, 0, 59, 60, 1, 0, 0, 0, 60, 7, 1, 0, 0,
        0, 61, 59, 1, 0, 0, 0, 62, 63, 6, 4, -1, 0, 63, 67, 3, 6, 3, 0, 64, 65, 5, 13, 0, 0, 65, 67, 3, 4, 2,
        0, 66, 62, 1, 0, 0, 0, 66, 64, 1, 0, 0, 0, 67, 73, 1, 0, 0, 0, 68, 69, 10, 2, 0, 0, 69, 70, 7, 0, 0,
        0, 70, 72, 3, 6, 3, 0, 71, 68, 1, 0, 0, 0, 72, 75, 1, 0, 0, 0, 73, 71, 1, 0, 0, 0, 73, 74, 1, 0, 0, 0,
        74, 9, 1, 0, 0, 0, 75, 73, 1, 0, 0, 0, 76, 77, 7, 1, 0, 0, 77, 11, 1, 0, 0, 0, 78, 79, 5, 10, 0, 0, 79,
        13, 1, 0, 0, 0, 8, 28, 31, 44, 46, 53, 59, 66, 73];
    static __ATN;
    static get _ATN() {
        if (!arithmeticParser.__ATN) {
            arithmeticParser.__ATN = new antlr4_1.ATNDeserializer().deserialize(arithmeticParser._serializedATN);
        }
        return arithmeticParser.__ATN;
    }
    static DecisionsToDFA = arithmeticParser._ATN.decisionToState.map((ds, index) => new antlr4_1.DFA(ds, index));
}
exports["default"] = arithmeticParser;
class EquationContext extends antlr4_1.ParserRuleContext {
    constructor(parser, parent, invokingState) {
        super(parent, invokingState);
        this.parser = parser;
    }
    expression_list() {
        return this.getTypedRuleContexts(ExpressionContext);
    }
    expression(i) {
        return this.getTypedRuleContext(ExpressionContext, i);
    }
    relop() {
        return this.getTypedRuleContext(RelopContext, 0);
    }
    get ruleIndex() {
        return arithmeticParser.RULE_equation;
    }
    enterRule(listener) {
        if (listener.enterEquation) {
            listener.enterEquation(this);
        }
    }
    exitRule(listener) {
        if (listener.exitEquation) {
            listener.exitEquation(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitEquation) {
            return visitor.visitEquation(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.EquationContext = EquationContext;
class ExpressionContext extends antlr4_1.ParserRuleContext {
    constructor(parser, parent, invokingState) {
        super(parent, invokingState);
        this.parser = parser;
    }
    open() {
        return this.getTypedRuleContext(OpenContext, 0);
    }
    get ruleIndex() {
        return arithmeticParser.RULE_expression;
    }
    enterRule(listener) {
        if (listener.enterExpression) {
            listener.enterExpression(this);
        }
    }
    exitRule(listener) {
        if (listener.exitExpression) {
            listener.exitExpression(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitExpression) {
            return visitor.visitExpression(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.ExpressionContext = ExpressionContext;
class ClosedContext extends antlr4_1.ParserRuleContext {
    constructor(parser, parent, invokingState) {
        super(parent, invokingState);
        this.parser = parser;
    }
    get ruleIndex() {
        return arithmeticParser.RULE_closed;
    }
    copyFrom(ctx) {
        super.copyFrom(ctx);
    }
}
exports.ClosedContext = ClosedContext;
class ImplicitProductContext extends ClosedContext {
    _left;
    _right;
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    closed_list() {
        return this.getTypedRuleContexts(ClosedContext);
    }
    closed(i) {
        return this.getTypedRuleContext(ClosedContext, i);
    }
    enterRule(listener) {
        if (listener.enterImplicitProduct) {
            listener.enterImplicitProduct(this);
        }
    }
    exitRule(listener) {
        if (listener.exitImplicitProduct) {
            listener.exitImplicitProduct(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitImplicitProduct) {
            return visitor.visitImplicitProduct(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.ImplicitProductContext = ImplicitProductContext;
class LogContext extends ClosedContext {
    _base;
    _content;
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    LOG() {
        return this.getToken(arithmeticParser.LOG, 0);
    }
    closed_list() {
        return this.getTypedRuleContexts(ClosedContext);
    }
    closed(i) {
        return this.getTypedRuleContext(ClosedContext, i);
    }
    enterRule(listener) {
        if (listener.enterLog) {
            listener.enterLog(this);
        }
    }
    exitRule(listener) {
        if (listener.exitLog) {
            listener.exitLog(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitLog) {
            return visitor.visitLog(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.LogContext = LogContext;
class ProductContext extends ClosedContext {
    _left;
    _right;
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    TIMES() {
        return this.getToken(arithmeticParser.TIMES, 0);
    }
    closed_list() {
        return this.getTypedRuleContexts(ClosedContext);
    }
    closed(i) {
        return this.getTypedRuleContext(ClosedContext, i);
    }
    enterRule(listener) {
        if (listener.enterProduct) {
            listener.enterProduct(this);
        }
    }
    exitRule(listener) {
        if (listener.exitProduct) {
            listener.exitProduct(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitProduct) {
            return visitor.visitProduct(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.ProductContext = ProductContext;
class DivisionContext extends ClosedContext {
    _left;
    _right;
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    DIV() {
        return this.getToken(arithmeticParser.DIV, 0);
    }
    closed_list() {
        return this.getTypedRuleContexts(ClosedContext);
    }
    closed(i) {
        return this.getTypedRuleContext(ClosedContext, i);
    }
    enterRule(listener) {
        if (listener.enterDivision) {
            listener.enterDivision(this);
        }
    }
    exitRule(listener) {
        if (listener.exitDivision) {
            listener.exitDivision(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitDivision) {
            return visitor.visitDivision(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.DivisionContext = DivisionContext;
class ClosedAtomContext extends ClosedContext {
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    atom() {
        return this.getTypedRuleContext(AtomContext, 0);
    }
    enterRule(listener) {
        if (listener.enterClosedAtom) {
            listener.enterClosedAtom(this);
        }
    }
    exitRule(listener) {
        if (listener.exitClosedAtom) {
            listener.exitClosedAtom(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitClosedAtom) {
            return visitor.visitClosedAtom(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.ClosedAtomContext = ClosedAtomContext;
class PowerContext extends ClosedContext {
    _left;
    _right;
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    POW() {
        return this.getToken(arithmeticParser.POW, 0);
    }
    closed_list() {
        return this.getTypedRuleContexts(ClosedContext);
    }
    closed(i) {
        return this.getTypedRuleContext(ClosedContext, i);
    }
    enterRule(listener) {
        if (listener.enterPower) {
            listener.enterPower(this);
        }
    }
    exitRule(listener) {
        if (listener.exitPower) {
            listener.exitPower(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitPower) {
            return visitor.visitPower(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.PowerContext = PowerContext;
class ParenContext extends ClosedContext {
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    LPAREN() {
        return this.getToken(arithmeticParser.LPAREN, 0);
    }
    open() {
        return this.getTypedRuleContext(OpenContext, 0);
    }
    RPAREN() {
        return this.getToken(arithmeticParser.RPAREN, 0);
    }
    enterRule(listener) {
        if (listener.enterParen) {
            listener.enterParen(this);
        }
    }
    exitRule(listener) {
        if (listener.exitParen) {
            listener.exitParen(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitParen) {
            return visitor.visitParen(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.ParenContext = ParenContext;
class Right_closedContext extends antlr4_1.ParserRuleContext {
    constructor(parser, parent, invokingState) {
        super(parent, invokingState);
        this.parser = parser;
    }
    get ruleIndex() {
        return arithmeticParser.RULE_right_closed;
    }
    copyFrom(ctx) {
        super.copyFrom(ctx);
    }
}
exports.Right_closedContext = Right_closedContext;
class UnaryOnExpressionContext extends Right_closedContext {
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    closed() {
        return this.getTypedRuleContext(ClosedContext, 0);
    }
    PLUS() {
        return this.getToken(arithmeticParser.PLUS, 0);
    }
    MINUS() {
        return this.getToken(arithmeticParser.MINUS, 0);
    }
    enterRule(listener) {
        if (listener.enterUnaryOnExpression) {
            listener.enterUnaryOnExpression(this);
        }
    }
    exitRule(listener) {
        if (listener.exitUnaryOnExpression) {
            listener.exitUnaryOnExpression(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitUnaryOnExpression) {
            return visitor.visitUnaryOnExpression(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.UnaryOnExpressionContext = UnaryOnExpressionContext;
class ClosedIsRight_ClosedContext extends Right_closedContext {
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    closed() {
        return this.getTypedRuleContext(ClosedContext, 0);
    }
    enterRule(listener) {
        if (listener.enterClosedIsRight_Closed) {
            listener.enterClosedIsRight_Closed(this);
        }
    }
    exitRule(listener) {
        if (listener.exitClosedIsRight_Closed) {
            listener.exitClosedIsRight_Closed(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitClosedIsRight_Closed) {
            return visitor.visitClosedIsRight_Closed(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.ClosedIsRight_ClosedContext = ClosedIsRight_ClosedContext;
class Right_ClosedImplicitProductContext extends Right_closedContext {
    _left;
    _right;
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    right_closed() {
        return this.getTypedRuleContext(Right_closedContext, 0);
    }
    closed() {
        return this.getTypedRuleContext(ClosedContext, 0);
    }
    enterRule(listener) {
        if (listener.enterRight_ClosedImplicitProduct) {
            listener.enterRight_ClosedImplicitProduct(this);
        }
    }
    exitRule(listener) {
        if (listener.exitRight_ClosedImplicitProduct) {
            listener.exitRight_ClosedImplicitProduct(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitRight_ClosedImplicitProduct) {
            return visitor.visitRight_ClosedImplicitProduct(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.Right_ClosedImplicitProductContext = Right_ClosedImplicitProductContext;
class OpenContext extends antlr4_1.ParserRuleContext {
    constructor(parser, parent, invokingState) {
        super(parent, invokingState);
        this.parser = parser;
    }
    get ruleIndex() {
        return arithmeticParser.RULE_open;
    }
    copyFrom(ctx) {
        super.copyFrom(ctx);
    }
}
exports.OpenContext = OpenContext;
class Right_ClosedIsOpenContext extends OpenContext {
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    right_closed() {
        return this.getTypedRuleContext(Right_closedContext, 0);
    }
    enterRule(listener) {
        if (listener.enterRight_ClosedIsOpen) {
            listener.enterRight_ClosedIsOpen(this);
        }
    }
    exitRule(listener) {
        if (listener.exitRight_ClosedIsOpen) {
            listener.exitRight_ClosedIsOpen(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitRight_ClosedIsOpen) {
            return visitor.visitRight_ClosedIsOpen(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.Right_ClosedIsOpenContext = Right_ClosedIsOpenContext;
class IntegralContext extends OpenContext {
    _integrand;
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    INT() {
        return this.getToken(arithmeticParser.INT, 0);
    }
    closed() {
        return this.getTypedRuleContext(ClosedContext, 0);
    }
    enterRule(listener) {
        if (listener.enterIntegral) {
            listener.enterIntegral(this);
        }
    }
    exitRule(listener) {
        if (listener.exitIntegral) {
            listener.exitIntegral(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitIntegral) {
            return visitor.visitIntegral(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.IntegralContext = IntegralContext;
class SumContext extends OpenContext {
    _left;
    _right;
    constructor(parser, ctx) {
        super(parser, ctx.parentCtx, ctx.invokingState);
        super.copyFrom(ctx);
    }
    open() {
        return this.getTypedRuleContext(OpenContext, 0);
    }
    PLUS() {
        return this.getToken(arithmeticParser.PLUS, 0);
    }
    MINUS() {
        return this.getToken(arithmeticParser.MINUS, 0);
    }
    right_closed() {
        return this.getTypedRuleContext(Right_closedContext, 0);
    }
    enterRule(listener) {
        if (listener.enterSum) {
            listener.enterSum(this);
        }
    }
    exitRule(listener) {
        if (listener.exitSum) {
            listener.exitSum(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitSum) {
            return visitor.visitSum(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.SumContext = SumContext;
class AtomContext extends antlr4_1.ParserRuleContext {
    constructor(parser, parent, invokingState) {
        super(parent, invokingState);
        this.parser = parser;
    }
    SCIENTIFIC_NUMBER() {
        return this.getToken(arithmeticParser.SCIENTIFIC_NUMBER, 0);
    }
    VARIABLE() {
        return this.getToken(arithmeticParser.VARIABLE, 0);
    }
    get ruleIndex() {
        return arithmeticParser.RULE_atom;
    }
    enterRule(listener) {
        if (listener.enterAtom) {
            listener.enterAtom(this);
        }
    }
    exitRule(listener) {
        if (listener.exitAtom) {
            listener.exitAtom(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitAtom) {
            return visitor.visitAtom(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.AtomContext = AtomContext;
class RelopContext extends antlr4_1.ParserRuleContext {
    constructor(parser, parent, invokingState) {
        super(parent, invokingState);
        this.parser = parser;
    }
    EQ() {
        return this.getToken(arithmeticParser.EQ, 0);
    }
    get ruleIndex() {
        return arithmeticParser.RULE_relop;
    }
    enterRule(listener) {
        if (listener.enterRelop) {
            listener.enterRelop(this);
        }
    }
    exitRule(listener) {
        if (listener.exitRelop) {
            listener.exitRelop(this);
        }
    }
    // @Override
    accept(visitor) {
        if (visitor.visitRelop) {
            return visitor.visitRelop(this);
        }
        else {
            return visitor.visitChildren(this);
        }
    }
}
exports.RelopContext = RelopContext;


/***/ }),

/***/ "./src/mathlib/userinput/arithmeticVisitor.ts":
/*!****************************************************!*\
  !*** ./src/mathlib/userinput/arithmeticVisitor.ts ***!
  \****************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

// Generated from ./src/mathlib/userinput/arithmetic.g4 by ANTLR 4.13.0
Object.defineProperty(exports, "__esModule", ({ value: true }));
const antlr4_1 = __webpack_require__(/*! antlr4 */ "./node_modules/antlr4/dist/antlr4.web.cjs");
/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `arithmeticParser`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
class arithmeticVisitor extends antlr4_1.ParseTreeVisitor {
    /**
     * Visit a parse tree produced by `arithmeticParser.equation`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitEquation;
    /**
     * Visit a parse tree produced by `arithmeticParser.expression`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitExpression;
    /**
     * Visit a parse tree produced by the `ImplicitProduct`
     * labeled alternative in `arithmeticParser.closed`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitImplicitProduct;
    /**
     * Visit a parse tree produced by the `Log`
     * labeled alternative in `arithmeticParser.closed`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitLog;
    /**
     * Visit a parse tree produced by the `Product`
     * labeled alternative in `arithmeticParser.closed`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitProduct;
    /**
     * Visit a parse tree produced by the `Division`
     * labeled alternative in `arithmeticParser.closed`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitDivision;
    /**
     * Visit a parse tree produced by the `ClosedAtom`
     * labeled alternative in `arithmeticParser.closed`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitClosedAtom;
    /**
     * Visit a parse tree produced by the `Power`
     * labeled alternative in `arithmeticParser.closed`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPower;
    /**
     * Visit a parse tree produced by the `Paren`
     * labeled alternative in `arithmeticParser.closed`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitParen;
    /**
     * Visit a parse tree produced by the `UnaryOnExpression`
     * labeled alternative in `arithmeticParser.right_closed`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitUnaryOnExpression;
    /**
     * Visit a parse tree produced by the `ClosedIsRight_Closed`
     * labeled alternative in `arithmeticParser.right_closed`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitClosedIsRight_Closed;
    /**
     * Visit a parse tree produced by the `Right_ClosedImplicitProduct`
     * labeled alternative in `arithmeticParser.right_closed`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitRight_ClosedImplicitProduct;
    /**
     * Visit a parse tree produced by the `Right_ClosedIsOpen`
     * labeled alternative in `arithmeticParser.open`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitRight_ClosedIsOpen;
    /**
     * Visit a parse tree produced by the `Integral`
     * labeled alternative in `arithmeticParser.open`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitIntegral;
    /**
     * Visit a parse tree produced by the `Sum`
     * labeled alternative in `arithmeticParser.open`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitSum;
    /**
     * Visit a parse tree produced by `arithmeticParser.atom`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitAtom;
    /**
     * Visit a parse tree produced by `arithmeticParser.relop`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitRelop;
}
exports["default"] = arithmeticVisitor;


/***/ }),

/***/ "./src/mathlib/util/MathMLHelpers.ts":
/*!*******************************************!*\
  !*** ./src/mathlib/util/MathMLHelpers.ts ***!
  \*******************************************/
/***/ ((__unused_webpack_module, exports) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.inMathBlock = exports.inMath = exports.inRow = exports.inParen = void 0;
/**
 * Wraps the given mathml string in mathml parenthases.
 * @param str
 */
function inParen(str) {
    return "<mo>(</mo>" + str + "<mo>)</mo>";
}
exports.inParen = inParen;
/**
 * Puts the given mathml expression in a row so that
 * it doesn't get divided by mathjax.
 * @param str
 * @returns
 */
function inRow(str) {
    return "<mrow>" + str + "</mrow>";
}
exports.inRow = inRow;
/**
 * Wraps the given string in <math></math>
 * @param str
 */
function inMath(str) {
    return "<math>" + str + "</math>";
}
exports.inMath = inMath;
/**
 * Wraps the given string in <math display='block'></math>
 * @param str
 */
function inMathBlock(str) {
    return "<math display='block'>" + str + "</math>";
}
exports.inMathBlock = inMathBlock;


/***/ }),

/***/ "./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts":
/*!***********************************************************!*\
  !*** ./src/mathlib/util/ThingsThatShouldBeInTheStdLib.ts ***!
  \***********************************************************/
/***/ ((__unused_webpack_module, exports) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.has = exports.addAll = exports.setOf = void 0;
function setOf(...arr) {
    const out = new Set();
    arr.forEach(e => out.add(e));
    return out;
}
exports.setOf = setOf;
/**
 * Adds the given elements to the given collection
 * @param collection
 * @param elements
 */
function addAll(collection, ...elements) {
    for (const e of elements) {
        collection.add(e);
    }
}
exports.addAll = addAll;
/**
 * Checks if the given element is in the given collection
 * using referencial equality.
 * @param collection
 * @param element
 * @returns True if the collection has the element, false otherwise.
 */
function has(collection, element) {
    for (const e of collection) {
        if (e === element)
            return true;
    }
    return false;
}
exports.has = has;


/***/ }),

/***/ "./src/mathlib/util/assert.ts":
/*!************************************!*\
  !*** ./src/mathlib/util/assert.ts ***!
  \************************************/
/***/ ((__unused_webpack_module, exports) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.assert = void 0;
/**
 * Checks if the given expression evaluated to true. If not, throws error
 * with the message given.
 * @param msg Displayed if the expression is false. Defaults to "Failed Assert"
 */
function assert(exp, msg = "Failed assert") {
    if (!exp)
        throw new Error(msg);
}
exports.assert = assert;


/***/ }),

/***/ "./node_modules/antlr4/dist/antlr4.web.cjs":
/*!*************************************************!*\
  !*** ./node_modules/antlr4/dist/antlr4.web.cjs ***!
  \*************************************************/
/***/ ((__unused_webpack_module, exports) => {

(()=>{var t={92:()=>{}},e={};function n(r){var o=e[r];if(void 0!==o)return o.exports;var i=e[r]={exports:{}};return t[r](i,i.exports,n),i.exports}n.d=(t,e)=>{for(var r in e)n.o(e,r)&&!n.o(t,r)&&Object.defineProperty(t,r,{enumerable:!0,get:e[r]})},n.o=(t,e)=>Object.prototype.hasOwnProperty.call(t,e),n.r=t=>{"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(t,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(t,"__esModule",{value:!0})};var r={};(()=>{"use strict";function t(e){return t="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},t(e)}function e(e,n){for(var r=0;r<n.length;r++){var o=n[r];o.enumerable=o.enumerable||!1,o.configurable=!0,"value"in o&&(o.writable=!0),Object.defineProperty(e,(void 0,i=function(e,n){if("object"!==t(e)||null===e)return e;var r=e[Symbol.toPrimitive];if(void 0!==r){var o=r.call(e,"string");if("object"!==t(o))return o;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)}(o.key),"symbol"===t(i)?i:String(i)),o)}var i}n.r(r),n.d(r,{ATN:()=>Fe,ATNDeserializer:()=>Ho,BailErrorStrategy:()=>ta,CharStream:()=>aa,CharStreams:()=>va,CommonToken:()=>yi,CommonTokenStream:()=>Ra,DFA:()=>cc,DiagnosticErrorListener:()=>Ic,ErrorListener:()=>Go,FailedPredicateException:()=>jc,InputStream:()=>aa,Interval:()=>B,IntervalSet:()=>V,LL1Analyzer:()=>Ie,Lexer:()=>Ui,LexerATNSimulator:()=>Eu,NoViableAltException:()=>Bu,ParseTreeListener:()=>yc,ParseTreeVisitor:()=>vc,ParseTreeWalker:()=>gc,Parser:()=>Ua,ParserATNSimulator:()=>Yu,ParserRuleContext:()=>el,PredictionContextCache:()=>Xu,PredictionMode:()=>Iu,RecognitionException:()=>xi,RuleContext:()=>ee,RuleNode:()=>Ut,TerminalNode:()=>Ht,Token:()=>o,arrayToString:()=>b,default:()=>Ol});var o=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.source=null,this.type=null,this.channel=null,this.start=null,this.stop=null,this.tokenIndex=null,this.line=null,this.column=null,this._text=null}var n,r;return n=t,(r=[{key:"getTokenSource",value:function(){return this.source[0]}},{key:"getInputStream",value:function(){return this.source[1]}},{key:"text",get:function(){return this._text},set:function(t){this._text=t}}])&&e(n.prototype,r),Object.defineProperty(n,"prototype",{writable:!1}),t}();function i(t,e){if(!Array.isArray(t)||!Array.isArray(e))return!1;if(t===e)return!0;if(t.length!==e.length)return!1;for(var n=0;n<t.length;n++)if(!(t[n]===e[n]||t[n].equals&&t[n].equals(e[n])))return!1;return!0}function u(t){return u="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},u(t)}o.INVALID_TYPE=0,o.EPSILON=-2,o.MIN_USER_TOKEN_TYPE=1,o.EOF=-1,o.DEFAULT_CHANNEL=0,o.HIDDEN_CHANNEL=1;var c=Math.round(Math.random()*Math.pow(2,32));function a(t){if(!t)return 0;var e,n,r=u(t),o="string"===r?t:!("object"!==r||!t.toString)&&t.toString();if(!o)return 0;for(var i=3&o.length,a=o.length-i,l=c,s=3432918353,f=461845907,p=0;p<a;)n=255&o.charCodeAt(p)|(255&o.charCodeAt(++p))<<8|(255&o.charCodeAt(++p))<<16|(255&o.charCodeAt(++p))<<24,++p,l=27492+(65535&(e=5*(65535&(l=(l^=n=(65535&(n=(n=(65535&n)*s+(((n>>>16)*s&65535)<<16)&4294967295)<<15|n>>>17))*f+(((n>>>16)*f&65535)<<16)&4294967295)<<13|l>>>19))+((5*(l>>>16)&65535)<<16)&4294967295))+((58964+(e>>>16)&65535)<<16);switch(n=0,i){case 3:n^=(255&o.charCodeAt(p+2))<<16;case 2:n^=(255&o.charCodeAt(p+1))<<8;case 1:l^=n=(65535&(n=(n=(65535&(n^=255&o.charCodeAt(p)))*s+(((n>>>16)*s&65535)<<16)&4294967295)<<15|n>>>17))*f+(((n>>>16)*f&65535)<<16)&4294967295}return l^=o.length,l=2246822507*(65535&(l^=l>>>16))+((2246822507*(l>>>16)&65535)<<16)&4294967295,l=3266489909*(65535&(l^=l>>>13))+((3266489909*(l>>>16)&65535)<<16)&4294967295,(l^=l>>>16)>>>0}function l(t){return l="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},l(t)}function s(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==l(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==l(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===l(o)?o:String(o)),r)}var o}var f=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.count=0,this.hash=0}var e,n,r;return e=t,n=[{key:"update",value:function(){for(var t=0;t<arguments.length;t++){var e=arguments[t];if(null!=e)if(Array.isArray(e))this.update.apply(this,e);else{var n=0;switch(l(e)){case"undefined":case"function":continue;case"number":case"boolean":n=e;break;case"string":n=a(e);break;default:e.updateHashCode?e.updateHashCode(this):console.log("No updateHashCode for "+e.toString());continue}n=(n*=3432918353)<<15|n>>>17,n*=461845907,this.count=this.count+1;var r=this.hash^n;r=5*(r=r<<13|r>>>19)+3864292196,this.hash=r}}}},{key:"finish",value:function(){var t=this.hash^4*this.count;return t^=t>>>16,t*=2246822507,t^=t>>>13,(t*=3266489909)^t>>>16}}],r=[{key:"hashStuff",value:function(){var e=new t;return e.update.apply(e,arguments),e.finish()}}],n&&s(e.prototype,n),r&&s(e,r),Object.defineProperty(e,"prototype",{writable:!1}),t}();function p(t){return t?"string"==typeof t?a(t):t.hashCode():-1}function y(t,e){return t?t.equals(e):t===e}function h(t){return null===t?"null":t}function b(t){return Array.isArray(t)?"["+t.map(h).join(", ")+"]":"null"}function v(t){return v="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},v(t)}function d(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==v(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==v(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===v(o)?o:String(o)),r)}var o}var m="h-",g=function(){function t(e,n){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.data={},this.hashFunction=e||p,this.equalsFunction=n||y}var e,n;return e=t,n=[{key:"add",value:function(t){var e=m+this.hashFunction(t);if(e in this.data){for(var n=this.data[e],r=0;r<n.length;r++)if(this.equalsFunction(t,n[r]))return n[r];return n.push(t),t}return this.data[e]=[t],t}},{key:"has",value:function(t){return null!=this.get(t)}},{key:"get",value:function(t){var e=m+this.hashFunction(t);if(e in this.data)for(var n=this.data[e],r=0;r<n.length;r++)if(this.equalsFunction(t,n[r]))return n[r];return null}},{key:"values",value:function(){var t=this;return Object.keys(this.data).filter((function(t){return t.startsWith(m)})).flatMap((function(e){return t.data[e]}),this)}},{key:"toString",value:function(){return b(this.values())}},{key:"length",get:function(){var t=this;return Object.keys(this.data).filter((function(t){return t.startsWith(m)})).map((function(e){return t.data[e].length}),this).reduce((function(t,e){return t+e}),0)}}],n&&d(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function S(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&O(t,e)}function O(t,e){return O=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},O(t,e)}function w(t){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}();return function(){var n,r=_(t);if(e){var o=_(this).constructor;n=Reflect.construct(r,arguments,o)}else n=r.apply(this,arguments);return function(t,e){if(e&&("object"===P(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,n)}}function _(t){return _=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},_(t)}function P(t){return P="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},P(t)}function T(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function E(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==P(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==P(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===P(o)?o:String(o)),r)}var o}function k(t,e,n){return e&&E(t.prototype,e),n&&E(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t}var j=function(){function t(){T(this,t)}return k(t,[{key:"hashCode",value:function(){var t=new f;return this.updateHashCode(t),t.finish()}},{key:"evaluate",value:function(t,e){}},{key:"evalPrecedence",value:function(t,e){return this}}],[{key:"andContext",value:function(e,n){if(null===e||e===t.NONE)return n;if(null===n||n===t.NONE)return e;var r=new x(e,n);return 1===r.opnds.length?r.opnds[0]:r}},{key:"orContext",value:function(e,n){if(null===e)return n;if(null===n)return e;if(e===t.NONE||n===t.NONE)return t.NONE;var r=new R(e,n);return 1===r.opnds.length?r.opnds[0]:r}}]),t}(),x=function(t){S(n,t);var e=w(n);function n(t,r){var o;T(this,n),o=e.call(this);var i=new g;t instanceof n?t.opnds.map((function(t){i.add(t)})):i.add(t),r instanceof n?r.opnds.map((function(t){i.add(t)})):i.add(r);var u=C(i);if(u.length>0){var c=null;u.map((function(t){(null===c||t.precedence<c.precedence)&&(c=t)})),i.add(c)}return o.opnds=Array.from(i.values()),o}return k(n,[{key:"equals",value:function(t){return this===t||t instanceof n&&i(this.opnds,t.opnds)}},{key:"updateHashCode",value:function(t){t.update(this.opnds,"AND")}},{key:"evaluate",value:function(t,e){for(var n=0;n<this.opnds.length;n++)if(!this.opnds[n].evaluate(t,e))return!1;return!0}},{key:"evalPrecedence",value:function(t,e){for(var n=!1,r=[],o=0;o<this.opnds.length;o++){var i=this.opnds[o],u=i.evalPrecedence(t,e);if(n|=u!==i,null===u)return null;u!==j.NONE&&r.push(u)}if(!n)return this;if(0===r.length)return j.NONE;var c=null;return r.map((function(t){c=null===c?t:j.andContext(c,t)})),c}},{key:"toString",value:function(){var t=this.opnds.map((function(t){return t.toString()}));return(t.length>3?t.slice(3):t).join("&&")}}]),n}(j),R=function(t){S(n,t);var e=w(n);function n(t,r){var o;T(this,n),o=e.call(this);var i=new g;t instanceof n?t.opnds.map((function(t){i.add(t)})):i.add(t),r instanceof n?r.opnds.map((function(t){i.add(t)})):i.add(r);var u=C(i);if(u.length>0){var c=u.sort((function(t,e){return t.compareTo(e)})),a=c[c.length-1];i.add(a)}return o.opnds=Array.from(i.values()),o}return k(n,[{key:"equals",value:function(t){return this===t||t instanceof n&&i(this.opnds,t.opnds)}},{key:"updateHashCode",value:function(t){t.update(this.opnds,"OR")}},{key:"evaluate",value:function(t,e){for(var n=0;n<this.opnds.length;n++)if(this.opnds[n].evaluate(t,e))return!0;return!1}},{key:"evalPrecedence",value:function(t,e){for(var n=!1,r=[],o=0;o<this.opnds.length;o++){var i=this.opnds[o],u=i.evalPrecedence(t,e);if(n|=u!==i,u===j.NONE)return j.NONE;null!==u&&r.push(u)}if(!n)return this;if(0===r.length)return null;return r.map((function(t){return t})),null}},{key:"toString",value:function(){var t=this.opnds.map((function(t){return t.toString()}));return(t.length>3?t.slice(3):t).join("||")}}]),n}(j);function C(t){var e=[];return t.values().map((function(t){t instanceof j.PrecedencePredicate&&e.push(t)})),e}function A(t){return A="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},A(t)}function N(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==A(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==A(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===A(o)?o:String(o)),r)}var o}function I(t,e){if(null===t){var n={state:null,alt:null,context:null,semanticContext:null};return e&&(n.reachesIntoOuterContext=0),n}var r={};return r.state=t.state||null,r.alt=void 0===t.alt?null:t.alt,r.context=t.context||null,r.semanticContext=t.semanticContext||null,e&&(r.reachesIntoOuterContext=t.reachesIntoOuterContext||0,r.precedenceFilterSuppressed=t.precedenceFilterSuppressed||!1),r}var L=function(){function t(e,n){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.checkContext(e,n),e=I(e),n=I(n,!0),this.state=null!==e.state?e.state:n.state,this.alt=null!==e.alt?e.alt:n.alt,this.context=null!==e.context?e.context:n.context,this.semanticContext=null!==e.semanticContext?e.semanticContext:null!==n.semanticContext?n.semanticContext:j.NONE,this.reachesIntoOuterContext=n.reachesIntoOuterContext,this.precedenceFilterSuppressed=n.precedenceFilterSuppressed}var e,n;return e=t,(n=[{key:"checkContext",value:function(t,e){null!==t.context&&void 0!==t.context||null!==e&&null!==e.context&&void 0!==e.context||(this.context=null)}},{key:"hashCode",value:function(){var t=new f;return this.updateHashCode(t),t.finish()}},{key:"updateHashCode",value:function(t){t.update(this.state.stateNumber,this.alt,this.context,this.semanticContext)}},{key:"equals",value:function(e){return this===e||e instanceof t&&this.state.stateNumber===e.state.stateNumber&&this.alt===e.alt&&(null===this.context?null===e.context:this.context.equals(e.context))&&this.semanticContext.equals(e.semanticContext)&&this.precedenceFilterSuppressed===e.precedenceFilterSuppressed}},{key:"hashCodeForConfigSet",value:function(){var t=new f;return t.update(this.state.stateNumber,this.alt,this.semanticContext),t.finish()}},{key:"equalsForConfigSet",value:function(e){return this===e||e instanceof t&&this.state.stateNumber===e.state.stateNumber&&this.alt===e.alt&&this.semanticContext.equals(e.semanticContext)}},{key:"toString",value:function(){return"("+this.state+","+this.alt+(null!==this.context?",["+this.context.toString()+"]":"")+(this.semanticContext!==j.NONE?","+this.semanticContext.toString():"")+(this.reachesIntoOuterContext>0?",up="+this.reachesIntoOuterContext:"")+")"}}])&&N(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function D(t){return D="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},D(t)}function F(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==D(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==D(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===D(o)?o:String(o)),r)}var o}var B=function(){function t(e,n){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.start=e,this.stop=n}var e,n;return e=t,(n=[{key:"clone",value:function(){return new t(this.start,this.stop)}},{key:"contains",value:function(t){return t>=this.start&&t<this.stop}},{key:"toString",value:function(){return this.start===this.stop-1?this.start.toString():this.start.toString()+".."+(this.stop-1).toString()}},{key:"length",get:function(){return this.stop-this.start}}])&&F(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function M(t){return M="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},M(t)}function U(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==M(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==M(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===M(o)?o:String(o)),r)}var o}B.INVALID_INTERVAL=new B(-1,-2);var V=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.intervals=null,this.readOnly=!1}var e,n;return e=t,n=[{key:"first",value:function(t){return null===this.intervals||0===this.intervals.length?o.INVALID_TYPE:this.intervals[0].start}},{key:"addOne",value:function(t){this.addInterval(new B(t,t+1))}},{key:"addRange",value:function(t,e){this.addInterval(new B(t,e+1))}},{key:"addInterval",value:function(t){if(null===this.intervals)this.intervals=[],this.intervals.push(t.clone());else{for(var e=0;e<this.intervals.length;e++){var n=this.intervals[e];if(t.stop<n.start)return void this.intervals.splice(e,0,t);if(t.stop===n.start)return void(this.intervals[e]=new B(t.start,n.stop));if(t.start<=n.stop)return this.intervals[e]=new B(Math.min(n.start,t.start),Math.max(n.stop,t.stop)),void this.reduce(e)}this.intervals.push(t.clone())}}},{key:"addSet",value:function(t){var e=this;return null!==t.intervals&&t.intervals.forEach((function(t){return e.addInterval(t)}),this),this}},{key:"reduce",value:function(t){if(t<this.intervals.length-1){var e=this.intervals[t],n=this.intervals[t+1];e.stop>=n.stop?(this.intervals.splice(t+1,1),this.reduce(t)):e.stop>=n.start&&(this.intervals[t]=new B(e.start,n.stop),this.intervals.splice(t+1,1))}}},{key:"complement",value:function(e,n){var r=new t;return r.addInterval(new B(e,n+1)),null!==this.intervals&&this.intervals.forEach((function(t){return r.removeRange(t)})),r}},{key:"contains",value:function(t){if(null===this.intervals)return!1;for(var e=0;e<this.intervals.length;e++)if(this.intervals[e].contains(t))return!0;return!1}},{key:"removeRange",value:function(t){if(t.start===t.stop-1)this.removeOne(t.start);else if(null!==this.intervals)for(var e=0,n=0;n<this.intervals.length;n++){var r=this.intervals[e];if(t.stop<=r.start)return;if(t.start>r.start&&t.stop<r.stop){this.intervals[e]=new B(r.start,t.start);var o=new B(t.stop,r.stop);return void this.intervals.splice(e,0,o)}t.start<=r.start&&t.stop>=r.stop?(this.intervals.splice(e,1),e-=1):t.start<r.stop?this.intervals[e]=new B(r.start,t.start):t.stop<r.stop&&(this.intervals[e]=new B(t.stop,r.stop)),e+=1}}},{key:"removeOne",value:function(t){if(null!==this.intervals)for(var e=0;e<this.intervals.length;e++){var n=this.intervals[e];if(t<n.start)return;if(t===n.start&&t===n.stop-1)return void this.intervals.splice(e,1);if(t===n.start)return void(this.intervals[e]=new B(n.start+1,n.stop));if(t===n.stop-1)return void(this.intervals[e]=new B(n.start,n.stop-1));if(t<n.stop-1){var r=new B(n.start,t);return n.start=t+1,void this.intervals.splice(e,0,r)}}}},{key:"toString",value:function(t,e,n){return t=t||null,e=e||null,n=n||!1,null===this.intervals?"{}":null!==t||null!==e?this.toTokenString(t,e):n?this.toCharString():this.toIndexString()}},{key:"toCharString",value:function(){for(var t=[],e=0;e<this.intervals.length;e++){var n=this.intervals[e];n.stop===n.start+1?n.start===o.EOF?t.push("<EOF>"):t.push("'"+String.fromCharCode(n.start)+"'"):t.push("'"+String.fromCharCode(n.start)+"'..'"+String.fromCharCode(n.stop-1)+"'")}return t.length>1?"{"+t.join(", ")+"}":t[0]}},{key:"toIndexString",value:function(){for(var t=[],e=0;e<this.intervals.length;e++){var n=this.intervals[e];n.stop===n.start+1?n.start===o.EOF?t.push("<EOF>"):t.push(n.start.toString()):t.push(n.start.toString()+".."+(n.stop-1).toString())}return t.length>1?"{"+t.join(", ")+"}":t[0]}},{key:"toTokenString",value:function(t,e){for(var n=[],r=0;r<this.intervals.length;r++)for(var o=this.intervals[r],i=o.start;i<o.stop;i++)n.push(this.elementName(t,e,i));return n.length>1?"{"+n.join(", ")+"}":n[0]}},{key:"elementName",value:function(t,e,n){return n===o.EOF?"<EOF>":n===o.EPSILON?"<EPSILON>":t[n]||e[n]}},{key:"length",get:function(){return this.intervals.map((function(t){return t.length})).reduce((function(t,e){return t+e}))}}],n&&U(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function z(t){return z="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},z(t)}function q(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==z(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==z(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===z(o)?o:String(o)),r)}var o}var H=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.atn=null,this.stateNumber=t.INVALID_STATE_NUMBER,this.stateType=null,this.ruleIndex=0,this.epsilonOnlyTransitions=!1,this.transitions=[],this.nextTokenWithinRule=null}var e,n;return e=t,(n=[{key:"toString",value:function(){return this.stateNumber}},{key:"equals",value:function(e){return e instanceof t&&this.stateNumber===e.stateNumber}},{key:"isNonGreedyExitState",value:function(){return!1}},{key:"addTransition",value:function(t,e){void 0===e&&(e=-1),0===this.transitions.length?this.epsilonOnlyTransitions=t.isEpsilon:this.epsilonOnlyTransitions!==t.isEpsilon&&(this.epsilonOnlyTransitions=!1),-1===e?this.transitions.push(t):this.transitions.splice(e,1,t)}}])&&q(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function K(t){return K="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},K(t)}function Y(t,e){return Y=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Y(t,e)}function G(t,e){if(e&&("object"===K(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return W(t)}function W(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function X(t){return X=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},X(t)}H.INVALID_TYPE=0,H.BASIC=1,H.RULE_START=2,H.BLOCK_START=3,H.PLUS_BLOCK_START=4,H.STAR_BLOCK_START=5,H.TOKEN_START=6,H.RULE_STOP=7,H.BLOCK_END=8,H.STAR_LOOP_BACK=9,H.STAR_LOOP_ENTRY=10,H.PLUS_LOOP_BACK=11,H.LOOP_END=12,H.serializationNames=["INVALID","BASIC","RULE_START","BLOCK_START","PLUS_BLOCK_START","STAR_BLOCK_START","TOKEN_START","RULE_STOP","BLOCK_END","STAR_LOOP_BACK","STAR_LOOP_ENTRY","PLUS_LOOP_BACK","LOOP_END"],H.INVALID_STATE_NUMBER=-1;var $=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Y(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=X(n);if(r){var o=X(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return G(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.RULE_STOP,G(t,W(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(H);function J(t){return J="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},J(t)}function Q(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==J(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==J(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===J(o)?o:String(o)),r)}var o}function Z(t,e,n){return e&&Q(t.prototype,e),n&&Q(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t}var tt=Z((function t(e){if(function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),null==e)throw"target cannot be null.";this.target=e,this.isEpsilon=!1,this.label=null}));function et(t){return et="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},et(t)}function nt(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==et(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==et(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===et(o)?o:String(o)),r)}var o}function rt(t,e){return rt=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},rt(t,e)}function ot(t){return ot=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},ot(t)}tt.EPSILON=1,tt.RANGE=2,tt.RULE=3,tt.PREDICATE=4,tt.ATOM=5,tt.ACTION=6,tt.SET=7,tt.NOT_SET=8,tt.WILDCARD=9,tt.PRECEDENCE=10,tt.serializationNames=["INVALID","EPSILON","RANGE","RULE","PREDICATE","ATOM","ACTION","SET","NOT_SET","WILDCARD","PRECEDENCE"],tt.serializationTypes={EpsilonTransition:tt.EPSILON,RangeTransition:tt.RANGE,RuleTransition:tt.RULE,PredicateTransition:tt.PREDICATE,AtomTransition:tt.ATOM,ActionTransition:tt.ACTION,SetTransition:tt.SET,NotSetTransition:tt.NOT_SET,WildcardTransition:tt.WILDCARD,PrecedencePredicateTransition:tt.PRECEDENCE};var it=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&rt(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=ot(r);if(o){var n=ot(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===et(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e,n,r){var o;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(o=i.call(this,t)).ruleIndex=e,o.precedence=n,o.followState=r,o.serializationType=tt.RULE,o.isEpsilon=!0,o}return e=u,(n=[{key:"matches",value:function(t,e,n){return!1}}])&&nt(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(tt);function ut(t){return ut="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ut(t)}function ct(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==ut(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==ut(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===ut(o)?o:String(o)),r)}var o}function at(t,e){return at=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},at(t,e)}function lt(t){return lt=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},lt(t)}var st=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&at(t,e)}(c,t);var e,n,r,i,u=(r=c,i=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=lt(r);if(i){var n=lt(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===ut(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function c(t,e){var n;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,c),(n=u.call(this,t)).serializationType=tt.SET,null!=e?n.label=e:(n.label=new V,n.label.addOne(o.INVALID_TYPE)),n}return e=c,(n=[{key:"matches",value:function(t,e,n){return this.label.contains(t)}},{key:"toString",value:function(){return this.label.toString()}}])&&ct(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),c}(tt);function ft(t){return ft="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ft(t)}function pt(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==ft(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==ft(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===ft(o)?o:String(o)),r)}var o}function yt(){return yt="undefined"!=typeof Reflect&&Reflect.get?Reflect.get.bind():function(t,e,n){var r=function(t,e){for(;!Object.prototype.hasOwnProperty.call(t,e)&&null!==(t=bt(t)););return t}(t,e);if(r){var o=Object.getOwnPropertyDescriptor(r,e);return o.get?o.get.call(arguments.length<3?t:n):o.value}},yt.apply(this,arguments)}function ht(t,e){return ht=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},ht(t,e)}function bt(t){return bt=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},bt(t)}var vt=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&ht(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=bt(r);if(o){var n=bt(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===ft(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e){var n;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(n=i.call(this,t,e)).serializationType=tt.NOT_SET,n}return e=u,(n=[{key:"matches",value:function(t,e,n){return t>=e&&t<=n&&!yt(bt(u.prototype),"matches",this).call(this,t,e,n)}},{key:"toString",value:function(){return"~"+yt(bt(u.prototype),"toString",this).call(this)}}])&&pt(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(st);function dt(t){return dt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},dt(t)}function mt(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==dt(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==dt(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===dt(o)?o:String(o)),r)}var o}function gt(t,e){return gt=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},gt(t,e)}function St(t){return St=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},St(t)}var Ot=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&gt(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=St(r);if(o){var n=St(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===dt(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(e=i.call(this,t)).serializationType=tt.WILDCARD,e}return e=u,(n=[{key:"matches",value:function(t,e,n){return t>=e&&t<=n}},{key:"toString",value:function(){return"."}}])&&mt(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(tt);function wt(t){return wt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},wt(t)}function _t(t,e){return _t=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},_t(t,e)}function Pt(t){return Pt=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Pt(t)}var Tt=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&_t(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Pt(n);if(r){var o=Pt(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===wt(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(t){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),o.call(this,t)}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(tt);function Et(t){return Et="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Et(t)}function kt(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Et(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Et(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Et(o)?o:String(o)),r)}var o}function jt(t,e,n){return e&&kt(t.prototype,e),n&&kt(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t}function xt(t){return xt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},xt(t)}function Rt(t,e){return Rt=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Rt(t,e)}function Ct(t){return Ct=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Ct(t)}function At(t){return At="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},At(t)}function Nt(t,e){return Nt=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Nt(t,e)}function It(t){return It=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},It(t)}var Lt=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Nt(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=It(n);if(r){var o=It(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===At(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),o.apply(this,arguments)}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Rt(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Ct(n);if(r){var o=Ct(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===xt(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),o.apply(this,arguments)}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(jt((function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t)}))));function Dt(t){return Dt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Dt(t)}function Ft(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Dt(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Dt(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Dt(o)?o:String(o)),r)}var o}function Bt(t,e){return Bt=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Bt(t,e)}function Mt(t){return Mt=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Mt(t)}var Ut=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Bt(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Mt(r);if(o){var n=Mt(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Dt(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),i.apply(this,arguments)}return e=u,(n=[{key:"ruleContext",get:function(){throw new Error("missing interface implementation")}}])&&Ft(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Lt);function Vt(t){return Vt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Vt(t)}function zt(t,e){return zt=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},zt(t,e)}function qt(t){return qt=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},qt(t)}var Ht=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&zt(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=qt(n);if(r){var o=qt(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Vt(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),o.apply(this,arguments)}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(Lt);function Kt(t){return Kt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Kt(t)}function Yt(t,e){return Yt=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Yt(t,e)}function Gt(t){return Gt=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Gt(t)}var Wt=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Yt(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Gt(n);if(r){var o=Gt(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Kt(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),o.apply(this,arguments)}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(Ht),Xt={toStringTree:function(t,e,n){e=e||null,null!==(n=n||null)&&(e=n.ruleNames);var r=Xt.getNodeText(t,e);r=function(t,e){return t=t.replace(/\t/g,"\\t").replace(/\n/g,"\\n").replace(/\r/g,"\\r")}(r);var o=t.getChildCount();if(0===o)return r;var i="("+r+" ";o>0&&(r=Xt.toStringTree(t.getChild(0),e),i=i.concat(r));for(var u=1;u<o;u++)r=Xt.toStringTree(t.getChild(u),e),i=i.concat(" "+r);return i.concat(")")},getNodeText:function(t,e,n){if(e=e||null,null!==(n=n||null)&&(e=n.ruleNames),null!==e){if(t instanceof Ut){var r=t.ruleContext.getAltNumber();return 0!=r?e[t.ruleIndex]+":"+r:e[t.ruleIndex]}if(t instanceof Wt)return t.toString();if(t instanceof Ht&&null!==t.symbol)return t.symbol.text}var i=t.getPayload();return i instanceof o?i.text:t.getPayload().toString()},getChildren:function(t){for(var e=[],n=0;n<t.getChildCount();n++)e.push(t.getChild(n));return e},getAncestors:function(t){var e=[];for(t=t.getParent();null!==t;)e=[t].concat(e),t=t.getParent();return e},findAllTokenNodes:function(t,e){return Xt.findAllNodes(t,e,!0)},findAllRuleNodes:function(t,e){return Xt.findAllNodes(t,e,!1)},findAllNodes:function(t,e,n){var r=[];return Xt._findAllNodes(t,e,n,r),r},_findAllNodes:function(t,e,n,r){n&&t instanceof Ht?t.symbol.type===e&&r.push(t):!n&&t instanceof Ut&&t.ruleIndex===e&&r.push(t);for(var o=0;o<t.getChildCount();o++)Xt._findAllNodes(t.getChild(o),e,n,r)},descendants:function(t){for(var e=[t],n=0;n<t.getChildCount();n++)e=e.concat(Xt.descendants(t.getChild(n)));return e}};const $t=Xt;function Jt(t){return Jt="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Jt(t)}function Qt(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Jt(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Jt(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Jt(o)?o:String(o)),r)}var o}function Zt(t,e){return Zt=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Zt(t,e)}function te(t){return te=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},te(t)}var ee=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Zt(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=te(r);if(o){var n=te(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Jt(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e){var n;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(n=i.call(this)).parentCtx=t||null,n.invokingState=e||-1,n}return e=u,(n=[{key:"depth",value:function(){for(var t=0,e=this;null!==e;)e=e.parentCtx,t+=1;return t}},{key:"isEmpty",value:function(){return-1===this.invokingState}},{key:"getSourceInterval",value:function(){return B.INVALID_INTERVAL}},{key:"ruleContext",get:function(){return this}},{key:"getPayload",value:function(){return this}},{key:"getText",value:function(){return 0===this.getChildCount()?"":this.children.map((function(t){return t.getText()})).join("")}},{key:"getAltNumber",value:function(){return 0}},{key:"setAltNumber",value:function(t){}},{key:"getChild",value:function(t){return null}},{key:"getChildCount",value:function(){return 0}},{key:"accept",value:function(t){return t.visitChildren(this)}},{key:"toStringTree",value:function(t,e){return $t.toStringTree(this,t,e)}},{key:"toString",value:function(t,e){t=t||null,e=e||null;for(var n=this,r="[";null!==n&&n!==e;){if(null===t)n.isEmpty()||(r+=n.invokingState);else{var o=n.ruleIndex;r+=o>=0&&o<t.length?t[o]:""+o}null===n.parentCtx||null===t&&n.parentCtx.isEmpty()||(r+=" "),n=n.parentCtx}return r+"]"}}])&&Qt(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Ut);function ne(t){return ne="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ne(t)}function re(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==ne(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==ne(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===ne(o)?o:String(o)),r)}var o}var oe=function(){function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.cachedHashCode=e}var e,n;return e=t,(n=[{key:"isEmpty",value:function(){return this===t.EMPTY}},{key:"hasEmptyPath",value:function(){return this.getReturnState(this.length-1)===t.EMPTY_RETURN_STATE}},{key:"hashCode",value:function(){return this.cachedHashCode}},{key:"updateHashCode",value:function(t){t.update(this.cachedHashCode)}}])&&re(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function ie(t){return ie="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ie(t)}function ue(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==ie(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==ie(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===ie(o)?o:String(o)),r)}var o}function ce(t,e){return ce=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},ce(t,e)}function ae(t,e){if(e&&("object"===ie(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return le(t)}function le(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function se(t){return se=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},se(t)}oe.EMPTY=null,oe.EMPTY_RETURN_STATE=2147483647,oe.globalNodeCount=1,oe.id=oe.globalNodeCount,oe.trace_atn_sim=!1;var fe=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&ce(t,e)}(c,t);var e,n,r,o,u=(r=c,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=se(r);if(o){var n=se(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return ae(this,t)});function c(t,e){var n;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,c);var r=new f;r.update(t,e);var o=r.finish();return(n=u.call(this,o)).parents=t,n.returnStates=e,ae(n,le(n))}return e=c,n=[{key:"isEmpty",value:function(){return this.returnStates[0]===oe.EMPTY_RETURN_STATE}},{key:"getParent",value:function(t){return this.parents[t]}},{key:"getReturnState",value:function(t){return this.returnStates[t]}},{key:"equals",value:function(t){return this===t||t instanceof c&&this.hashCode()===t.hashCode()&&i(this.returnStates,t.returnStates)&&i(this.parents,t.parents)}},{key:"toString",value:function(){if(this.isEmpty())return"[]";for(var t="[",e=0;e<this.returnStates.length;e++)e>0&&(t+=", "),this.returnStates[e]!==oe.EMPTY_RETURN_STATE?(t+=this.returnStates[e],null!==this.parents[e]?t=t+" "+this.parents[e]:t+="null"):t+="$";return t+"]"}},{key:"length",get:function(){return this.returnStates.length}}],n&&ue(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),c}(oe);function pe(t){return pe="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},pe(t)}function ye(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==pe(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==pe(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===pe(o)?o:String(o)),r)}var o}function he(t,e){return he=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},he(t,e)}function be(t){return be=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},be(t)}var ve=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&he(t,e)}(c,t);var e,n,r,o,i,u=(o=c,i=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=be(o);if(i){var n=be(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===pe(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function c(t,e){var n;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,c);var r,o=new f;return null!==t?o.update(t,e):o.update(1),r=o.finish(),(n=u.call(this,r)).parentCtx=t,n.returnState=e,n}return e=c,r=[{key:"create",value:function(t,e){return e===oe.EMPTY_RETURN_STATE&&null===t?oe.EMPTY:new c(t,e)}}],(n=[{key:"getParent",value:function(t){return this.parentCtx}},{key:"getReturnState",value:function(t){return this.returnState}},{key:"equals",value:function(t){return this===t||t instanceof c&&this.hashCode()===t.hashCode()&&this.returnState===t.returnState&&(null==this.parentCtx?null==t.parentCtx:this.parentCtx.equals(t.parentCtx))}},{key:"toString",value:function(){var t=null===this.parentCtx?"":this.parentCtx.toString();return 0===t.length?this.returnState===oe.EMPTY_RETURN_STATE?"$":""+this.returnState:this.returnState+" "+t}},{key:"length",get:function(){return 1}}])&&ye(e.prototype,n),r&&ye(e,r),Object.defineProperty(e,"prototype",{writable:!1}),c}(oe);function de(t){return de="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},de(t)}function me(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==de(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==de(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===de(o)?o:String(o)),r)}var o}function ge(t,e){return ge=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},ge(t,e)}function Se(t){return Se=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Se(t)}var Oe=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&ge(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Se(r);if(o){var n=Se(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===de(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),i.call(this,null,oe.EMPTY_RETURN_STATE)}return e=u,(n=[{key:"isEmpty",value:function(){return!0}},{key:"getParent",value:function(t){return null}},{key:"getReturnState",value:function(t){return this.returnState}},{key:"equals",value:function(t){return this===t}},{key:"toString",value:function(){return"$"}}])&&me(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(ve);function we(t){return we="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},we(t)}function _e(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==we(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==we(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===we(o)?o:String(o)),r)}var o}oe.EMPTY=new Oe;var Pe="h-",Te=function(){function t(e,n){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.data={},this.hashFunction=e||p,this.equalsFunction=n||y}var e,n;return e=t,n=[{key:"set",value:function(t,e){var n=Pe+this.hashFunction(t);if(n in this.data){for(var r=this.data[n],o=0;o<r.length;o++){var i=r[o];if(this.equalsFunction(t,i.key)){var u=i.value;return i.value=e,u}}return r.push({key:t,value:e}),e}return this.data[n]=[{key:t,value:e}],e}},{key:"containsKey",value:function(t){var e=Pe+this.hashFunction(t);if(e in this.data)for(var n=this.data[e],r=0;r<n.length;r++){var o=n[r];if(this.equalsFunction(t,o.key))return!0}return!1}},{key:"get",value:function(t){var e=Pe+this.hashFunction(t);if(e in this.data)for(var n=this.data[e],r=0;r<n.length;r++){var o=n[r];if(this.equalsFunction(t,o.key))return o.value}return null}},{key:"entries",value:function(){var t=this;return Object.keys(this.data).filter((function(t){return t.startsWith(Pe)})).flatMap((function(e){return t.data[e]}),this)}},{key:"getKeys",value:function(){return this.entries().map((function(t){return t.key}))}},{key:"getValues",value:function(){return this.entries().map((function(t){return t.value}))}},{key:"toString",value:function(){return"["+this.entries().map((function(t){return"{"+t.key+":"+t.value+"}"})).join(", ")+"]"}},{key:"length",get:function(){var t=this;return Object.keys(this.data).filter((function(t){return t.startsWith(Pe)})).map((function(e){return t.data[e].length}),this).reduce((function(t,e){return t+e}),0)}}],n&&_e(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function Ee(t,e){if(null==e&&(e=ee.EMPTY),null===e.parentCtx||e===ee.EMPTY)return oe.EMPTY;var n=Ee(t,e.parentCtx),r=t.states[e.invokingState].transitions[0];return ve.create(n,r.followState.stateNumber)}function ke(t,e,n){if(t.isEmpty())return t;var r=n.get(t)||null;if(null!==r)return r;if(null!==(r=e.get(t)))return n.set(t,r),r;for(var o=!1,i=[],u=0;u<i.length;u++){var c=ke(t.getParent(u),e,n);if(o||c!==t.getParent(u)){if(!o){i=[];for(var a=0;a<t.length;a++)i[a]=t.getParent(a);o=!0}i[u]=c}}if(!o)return e.add(t),n.set(t,t),t;var l;return l=0===i.length?oe.EMPTY:1===i.length?ve.create(i[0],t.getReturnState(0)):new fe(i,t.returnStates),e.add(l),n.set(l,l),n.set(t,l),l}function je(t,e,n,r){if(t===e)return t;if(t instanceof ve&&e instanceof ve)return function(t,e,n,r){if(null!==r){var o=r.get(t,e);if(null!==o)return o;if(null!==(o=r.get(e,t)))return o}var i=function(t,e,n){if(n){if(t===oe.EMPTY)return oe.EMPTY;if(e===oe.EMPTY)return oe.EMPTY}else{if(t===oe.EMPTY&&e===oe.EMPTY)return oe.EMPTY;if(t===oe.EMPTY){var r=[e.returnState,oe.EMPTY_RETURN_STATE],o=[e.parentCtx,null];return new fe(o,r)}if(e===oe.EMPTY){var i=[t.returnState,oe.EMPTY_RETURN_STATE],u=[t.parentCtx,null];return new fe(u,i)}}return null}(t,e,n);if(null!==i)return null!==r&&r.set(t,e,i),i;if(t.returnState===e.returnState){var u=je(t.parentCtx,e.parentCtx,n,r);if(u===t.parentCtx)return t;if(u===e.parentCtx)return e;var c=ve.create(u,t.returnState);return null!==r&&r.set(t,e,c),c}var a=null;if((t===e||null!==t.parentCtx&&t.parentCtx===e.parentCtx)&&(a=t.parentCtx),null!==a){var l=[t.returnState,e.returnState];t.returnState>e.returnState&&(l[0]=e.returnState,l[1]=t.returnState);var s=new fe([a,a],l);return null!==r&&r.set(t,e,s),s}var f=[t.returnState,e.returnState],p=[t.parentCtx,e.parentCtx];t.returnState>e.returnState&&(f[0]=e.returnState,f[1]=t.returnState,p=[e.parentCtx,t.parentCtx]);var y=new fe(p,f);return null!==r&&r.set(t,e,y),y}(t,e,n,r);if(n){if(t instanceof Oe)return t;if(e instanceof Oe)return e}return t instanceof ve&&(t=new fe([t.getParent()],[t.returnState])),e instanceof ve&&(e=new fe([e.getParent()],[e.returnState])),function(t,e,n,r){if(null!==r){var o=r.get(t,e);if(null!==o)return oe.trace_atn_sim&&console.log("mergeArrays a="+t+",b="+e+" -> previous"),o;if(null!==(o=r.get(e,t)))return oe.trace_atn_sim&&console.log("mergeArrays a="+t+",b="+e+" -> previous"),o}for(var i=0,u=0,c=0,a=new Array(t.returnStates.length+e.returnStates.length).fill(0),l=new Array(t.returnStates.length+e.returnStates.length).fill(null);i<t.returnStates.length&&u<e.returnStates.length;){var s=t.parents[i],f=e.parents[u];if(t.returnStates[i]===e.returnStates[u]){var p=t.returnStates[i];p===oe.EMPTY_RETURN_STATE&&null===s&&null===f||null!==s&&null!==f&&s===f?(l[c]=s,a[c]=p):(l[c]=je(s,f,n,r),a[c]=p),i+=1,u+=1}else t.returnStates[i]<e.returnStates[u]?(l[c]=s,a[c]=t.returnStates[i],i+=1):(l[c]=f,a[c]=e.returnStates[u],u+=1);c+=1}if(i<t.returnStates.length)for(var y=i;y<t.returnStates.length;y++)l[c]=t.parents[y],a[c]=t.returnStates[y],c+=1;else for(var h=u;h<e.returnStates.length;h++)l[c]=e.parents[h],a[c]=e.returnStates[h],c+=1;if(c<l.length){if(1===c){var b=ve.create(l[0],a[0]);return null!==r&&r.set(t,e,b),b}l=l.slice(0,c),a=a.slice(0,c)}var v=new fe(l,a);return v.equals(t)?(null!==r&&r.set(t,e,t),oe.trace_atn_sim&&console.log("mergeArrays a="+t+",b="+e+" -> a"),t):v.equals(e)?(null!==r&&r.set(t,e,e),oe.trace_atn_sim&&console.log("mergeArrays a="+t+",b="+e+" -> b"),e):(function(t){for(var e=new Te,n=0;n<t.length;n++){var r=t[n];e.containsKey(r)||e.set(r,r)}for(var o=0;o<t.length;o++)t[o]=e.get(t[o])}(l),null!==r&&r.set(t,e,v),oe.trace_atn_sim&&console.log("mergeArrays a="+t+",b="+e+" -> "+v),v)}(t,e,n,r)}function xe(t){return xe="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},xe(t)}function Re(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==xe(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==xe(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===xe(o)?o:String(o)),r)}var o}var Ce=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.data=[]}var e,n;return e=t,(n=[{key:"add",value:function(t){this.data[t]=!0}},{key:"or",value:function(t){var e=this;Object.keys(t.data).map((function(t){return e.add(t)}),this)}},{key:"remove",value:function(t){delete this.data[t]}},{key:"has",value:function(t){return!0===this.data[t]}},{key:"values",value:function(){return Object.keys(this.data)}},{key:"minValue",value:function(){return Math.min.apply(null,this.values())}},{key:"hashCode",value:function(){return f.hashStuff(this.values())}},{key:"equals",value:function(e){return e instanceof t&&i(this.data,e.data)}},{key:"toString",value:function(){return"{"+this.values().join(", ")+"}"}},{key:"length",get:function(){return this.values().length}}])&&Re(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function Ae(t){return Ae="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ae(t)}function Ne(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Ae(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Ae(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Ae(o)?o:String(o)),r)}var o}var Ie=function(){function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.atn=e}var e,n;return e=t,n=[{key:"getDecisionLookahead",value:function(e){if(null===e)return null;for(var n=e.transitions.length,r=[],o=0;o<n;o++){r[o]=new V;var i=new g;this._LOOK(e.transition(o).target,null,oe.EMPTY,r[o],i,new Ce,!1,!1),(0===r[o].length||r[o].contains(t.HIT_PRED))&&(r[o]=null)}return r}},{key:"LOOK",value:function(t,e,n){var r=new V,o=null!==(n=n||null)?Ee(t.atn,n):null;return this._LOOK(t,e,o,r,new g,new Ce,!0,!0),r}},{key:"_LOOK",value:function(e,n,r,i,u,c,a,l){var s=new L({state:e,alt:0,context:r},null);if(!u.has(s)){if(u.add(s),e===n){if(null===r)return void i.addOne(o.EPSILON);if(r.isEmpty()&&l)return void i.addOne(o.EOF)}if(e instanceof $){if(null===r)return void i.addOne(o.EPSILON);if(r.isEmpty()&&l)return void i.addOne(o.EOF);if(r!==oe.EMPTY){var f=c.has(e.ruleIndex);try{c.remove(e.ruleIndex);for(var p=0;p<r.length;p++){var y=this.atn.states[r.getReturnState(p)];this._LOOK(y,n,r.getParent(p),i,u,c,a,l)}}finally{f&&c.add(e.ruleIndex)}return}}for(var h=0;h<e.transitions.length;h++){var b=e.transitions[h];if(b.constructor===it){if(c.has(b.target.ruleIndex))continue;var v=ve.create(r,b.followState.stateNumber);try{c.add(b.target.ruleIndex),this._LOOK(b.target,n,v,i,u,c,a,l)}finally{c.remove(b.target.ruleIndex)}}else if(b instanceof Tt)a?this._LOOK(b.target,n,r,i,u,c,a,l):i.addOne(t.HIT_PRED);else if(b.isEpsilon)this._LOOK(b.target,n,r,i,u,c,a,l);else if(b.constructor===Ot)i.addRange(o.MIN_USER_TOKEN_TYPE,this.atn.maxTokenType);else{var d=b.label;null!==d&&(b instanceof vt&&(d=d.complement(o.MIN_USER_TOKEN_TYPE,this.atn.maxTokenType)),i.addSet(d))}}}}}],n&&Ne(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function Le(t){return Le="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Le(t)}function De(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Le(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Le(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Le(o)?o:String(o)),r)}var o}Ie.HIT_PRED=o.INVALID_TYPE;var Fe=function(){function t(e,n){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.grammarType=e,this.maxTokenType=n,this.states=[],this.decisionToState=[],this.ruleToStartState=[],this.ruleToStopState=null,this.modeNameToStartState={},this.ruleToTokenType=null,this.lexerActions=null,this.modeToStartState=[]}var e,n;return e=t,(n=[{key:"nextTokensInContext",value:function(t,e){return new Ie(this).LOOK(t,null,e)}},{key:"nextTokensNoContext",value:function(t){return null!==t.nextTokenWithinRule||(t.nextTokenWithinRule=this.nextTokensInContext(t,null),t.nextTokenWithinRule.readOnly=!0),t.nextTokenWithinRule}},{key:"nextTokens",value:function(t,e){return void 0===e?this.nextTokensNoContext(t):this.nextTokensInContext(t,e)}},{key:"addState",value:function(t){null!==t&&(t.atn=this,t.stateNumber=this.states.length),this.states.push(t)}},{key:"removeState",value:function(t){this.states[t.stateNumber]=null}},{key:"defineDecisionState",value:function(t){return this.decisionToState.push(t),t.decision=this.decisionToState.length-1,t.decision}},{key:"getDecisionState",value:function(t){return 0===this.decisionToState.length?null:this.decisionToState[t]}},{key:"getExpectedTokens",value:function(t,e){if(t<0||t>=this.states.length)throw"Invalid state number.";var n=this.states[t],r=this.nextTokens(n);if(!r.contains(o.EPSILON))return r;var i=new V;for(i.addSet(r),i.removeOne(o.EPSILON);null!==e&&e.invokingState>=0&&r.contains(o.EPSILON);){var u=this.states[e.invokingState].transitions[0];r=this.nextTokens(u.followState),i.addSet(r),i.removeOne(o.EPSILON),e=e.parentCtx}return r.contains(o.EPSILON)&&i.addOne(o.EOF),i}}])&&De(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();Fe.INVALID_ALT_NUMBER=0;function Be(t){return Be="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Be(t)}function Me(t,e){return Me=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Me(t,e)}function Ue(t){return Ue=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Ue(t)}var Ve=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Me(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Ue(n);if(r){var o=Ue(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Be(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.BASIC,t}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(H);function ze(t){return ze="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ze(t)}function qe(t,e){return qe=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},qe(t,e)}function He(t,e){if(e&&("object"===ze(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return Ke(t)}function Ke(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function Ye(t){return Ye=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Ye(t)}var Ge=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&qe(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Ye(n);if(r){var o=Ye(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return He(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).decision=-1,t.nonGreedy=!1,He(t,Ke(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(H);function We(t){return We="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},We(t)}function Xe(t,e){return Xe=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Xe(t,e)}function $e(t,e){if(e&&("object"===We(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return Je(t)}function Je(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function Qe(t){return Qe=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Qe(t)}var Ze=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Xe(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Qe(n);if(r){var o=Qe(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return $e(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).endState=null,$e(t,Je(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(Ge);function tn(t){return tn="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},tn(t)}function en(t,e){return en=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},en(t,e)}function nn(t,e){if(e&&("object"===tn(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return rn(t)}function rn(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function on(t){return on=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},on(t)}var un=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&en(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=on(n);if(r){var o=on(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return nn(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.BLOCK_END,t.startState=null,nn(t,rn(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(H);function cn(t){return cn="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},cn(t)}function an(t,e){return an=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},an(t,e)}function ln(t,e){if(e&&("object"===cn(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return sn(t)}function sn(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function fn(t){return fn=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},fn(t)}var pn=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&an(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=fn(n);if(r){var o=fn(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return ln(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.LOOP_END,t.loopBackState=null,ln(t,sn(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(H);function yn(t){return yn="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},yn(t)}function hn(t,e){return hn=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},hn(t,e)}function bn(t,e){if(e&&("object"===yn(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return vn(t)}function vn(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function dn(t){return dn=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},dn(t)}var mn=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&hn(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=dn(n);if(r){var o=dn(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return bn(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.RULE_START,t.stopState=null,t.isPrecedenceRule=!1,bn(t,vn(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(H);function gn(t){return gn="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},gn(t)}function Sn(t,e){return Sn=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Sn(t,e)}function On(t,e){if(e&&("object"===gn(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return wn(t)}function wn(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function _n(t){return _n=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},_n(t)}var Pn=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Sn(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=_n(n);if(r){var o=_n(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return On(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.TOKEN_START,On(t,wn(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(Ge);function Tn(t){return Tn="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Tn(t)}function En(t,e){return En=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},En(t,e)}function kn(t,e){if(e&&("object"===Tn(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return jn(t)}function jn(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function xn(t){return xn=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},xn(t)}var Rn=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&En(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=xn(n);if(r){var o=xn(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return kn(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.PLUS_LOOP_BACK,kn(t,jn(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(Ge);function Cn(t){return Cn="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Cn(t)}function An(t,e){return An=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},An(t,e)}function Nn(t,e){if(e&&("object"===Cn(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return In(t)}function In(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function Ln(t){return Ln=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Ln(t)}var Dn=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&An(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Ln(n);if(r){var o=Ln(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return Nn(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.STAR_LOOP_BACK,Nn(t,In(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(H);function Fn(t){return Fn="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Fn(t)}function Bn(t,e){return Bn=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Bn(t,e)}function Mn(t,e){if(e&&("object"===Fn(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return Un(t)}function Un(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function Vn(t){return Vn=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Vn(t)}var zn=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Bn(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Vn(n);if(r){var o=Vn(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return Mn(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.STAR_LOOP_ENTRY,t.loopBackState=null,t.isPrecedenceDecision=null,Mn(t,Un(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(Ge);function qn(t){return qn="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},qn(t)}function Hn(t,e){return Hn=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Hn(t,e)}function Kn(t,e){if(e&&("object"===qn(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return Yn(t)}function Yn(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function Gn(t){return Gn=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Gn(t)}var Wn=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Hn(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Gn(n);if(r){var o=Gn(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return Kn(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.PLUS_BLOCK_START,t.loopBackState=null,Kn(t,Yn(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(Ze);function Xn(t){return Xn="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Xn(t)}function $n(t,e){return $n=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},$n(t,e)}function Jn(t,e){if(e&&("object"===Xn(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return Qn(t)}function Qn(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function Zn(t){return Zn=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Zn(t)}var tr=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&$n(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Zn(n);if(r){var o=Zn(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return Jn(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.STAR_BLOCK_START,Jn(t,Qn(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(Ze);function er(t){return er="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},er(t)}function nr(t,e){return nr=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},nr(t,e)}function rr(t,e){if(e&&("object"===er(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return or(t)}function or(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function ir(t){return ir=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},ir(t)}var ur=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&nr(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=ir(n);if(r){var o=ir(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return rr(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).stateType=H.BLOCK_START,rr(t,or(t))}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(Ze);function cr(t){return cr="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},cr(t)}function ar(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==cr(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==cr(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===cr(o)?o:String(o)),r)}var o}function lr(t,e){return lr=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},lr(t,e)}function sr(t){return sr=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},sr(t)}var fr=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&lr(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=sr(r);if(o){var n=sr(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===cr(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e){var n;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(n=i.call(this,t)).label_=e,n.label=n.makeLabel(),n.serializationType=tt.ATOM,n}return e=u,(n=[{key:"makeLabel",value:function(){var t=new V;return t.addOne(this.label_),t}},{key:"matches",value:function(t,e,n){return this.label_===t}},{key:"toString",value:function(){return this.label_}}])&&ar(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(tt);function pr(t){return pr="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},pr(t)}function yr(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==pr(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==pr(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===pr(o)?o:String(o)),r)}var o}function hr(t,e){return hr=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},hr(t,e)}function br(t){return br=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},br(t)}var vr=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&hr(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=br(r);if(o){var n=br(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===pr(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e,n){var r;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(r=i.call(this,t)).serializationType=tt.RANGE,r.start=e,r.stop=n,r.label=r.makeLabel(),r}return e=u,(n=[{key:"makeLabel",value:function(){var t=new V;return t.addRange(this.start,this.stop),t}},{key:"matches",value:function(t,e,n){return t>=this.start&&t<=this.stop}},{key:"toString",value:function(){return"'"+String.fromCharCode(this.start)+"'..'"+String.fromCharCode(this.stop)+"'"}}])&&yr(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(tt);function dr(t){return dr="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},dr(t)}function mr(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==dr(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==dr(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===dr(o)?o:String(o)),r)}var o}function gr(t,e){return gr=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},gr(t,e)}function Sr(t){return Sr=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Sr(t)}var Or=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&gr(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Sr(r);if(o){var n=Sr(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===dr(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e,n,r){var o;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(o=i.call(this,t)).serializationType=tt.ACTION,o.ruleIndex=e,o.actionIndex=void 0===n?-1:n,o.isCtxDependent=void 0!==r&&r,o.isEpsilon=!0,o}return e=u,(n=[{key:"matches",value:function(t,e,n){return!1}},{key:"toString",value:function(){return"action_"+this.ruleIndex+":"+this.actionIndex}}])&&mr(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(tt);function wr(t){return wr="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},wr(t)}function _r(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==wr(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==wr(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===wr(o)?o:String(o)),r)}var o}function Pr(t,e){return Pr=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Pr(t,e)}function Tr(t){return Tr=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Tr(t)}var Er=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Pr(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Tr(r);if(o){var n=Tr(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===wr(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e){var n;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(n=i.call(this,t)).serializationType=tt.EPSILON,n.isEpsilon=!0,n.outermostPrecedenceReturn=e,n}return e=u,(n=[{key:"matches",value:function(t,e,n){return!1}},{key:"toString",value:function(){return"epsilon"}}])&&_r(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(tt);function kr(t){return kr="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},kr(t)}function jr(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==kr(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==kr(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===kr(o)?o:String(o)),r)}var o}function xr(t,e){return xr=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},xr(t,e)}function Rr(t){return Rr=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Rr(t)}var Cr=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&xr(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Rr(r);if(o){var n=Rr(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===kr(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e,n){var r;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(r=i.call(this)).ruleIndex=void 0===t?-1:t,r.predIndex=void 0===e?-1:e,r.isCtxDependent=void 0!==n&&n,r}return e=u,(n=[{key:"evaluate",value:function(t,e){var n=this.isCtxDependent?e:null;return t.sempred(n,this.ruleIndex,this.predIndex)}},{key:"updateHashCode",value:function(t){t.update(this.ruleIndex,this.predIndex,this.isCtxDependent)}},{key:"equals",value:function(t){return this===t||t instanceof u&&this.ruleIndex===t.ruleIndex&&this.predIndex===t.predIndex&&this.isCtxDependent===t.isCtxDependent}},{key:"toString",value:function(){return"{"+this.ruleIndex+":"+this.predIndex+"}?"}}])&&jr(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(j);function Ar(t){return Ar="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ar(t)}function Nr(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Ar(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Ar(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Ar(o)?o:String(o)),r)}var o}function Ir(t,e){return Ir=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Ir(t,e)}function Lr(t){return Lr=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Lr(t)}j.NONE=new Cr;var Dr=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Ir(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Lr(r);if(o){var n=Lr(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Ar(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e,n,r){var o;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(o=i.call(this,t)).serializationType=tt.PREDICATE,o.ruleIndex=e,o.predIndex=n,o.isCtxDependent=r,o.isEpsilon=!0,o}return e=u,(n=[{key:"matches",value:function(t,e,n){return!1}},{key:"getPredicate",value:function(){return new Cr(this.ruleIndex,this.predIndex,this.isCtxDependent)}},{key:"toString",value:function(){return"pred_"+this.ruleIndex+":"+this.predIndex}}])&&Nr(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Tt);function Fr(t){return Fr="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Fr(t)}function Br(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Fr(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Fr(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Fr(o)?o:String(o)),r)}var o}function Mr(t,e){return Mr=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Mr(t,e)}function Ur(t){return Ur=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Ur(t)}var Vr=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Mr(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Ur(r);if(o){var n=Ur(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Fr(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(e=i.call(this)).precedence=void 0===t?0:t,e}return e=u,(n=[{key:"evaluate",value:function(t,e){return t.precpred(e,this.precedence)}},{key:"evalPrecedence",value:function(t,e){return t.precpred(e,this.precedence)?j.NONE:null}},{key:"compareTo",value:function(t){return this.precedence-t.precedence}},{key:"updateHashCode",value:function(t){t.update(this.precedence)}},{key:"equals",value:function(t){return this===t||t instanceof u&&this.precedence===t.precedence}},{key:"toString",value:function(){return"{"+this.precedence+">=prec}?"}}])&&Br(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(j);function zr(t){return zr="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},zr(t)}function qr(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==zr(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==zr(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===zr(o)?o:String(o)),r)}var o}function Hr(t,e){return Hr=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Hr(t,e)}function Kr(t){return Kr=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Kr(t)}j.PrecedencePredicate=Vr;var Yr=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Hr(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Kr(r);if(o){var n=Kr(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===zr(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e){var n;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(n=i.call(this,t)).serializationType=tt.PRECEDENCE,n.precedence=e,n.isEpsilon=!0,n}return e=u,(n=[{key:"matches",value:function(t,e,n){return!1}},{key:"getPredicate",value:function(){return new Vr(this.precedence)}},{key:"toString",value:function(){return this.precedence+" >= _p"}}])&&qr(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Tt);function Gr(t){return Gr="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Gr(t)}function Wr(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Gr(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Gr(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Gr(o)?o:String(o)),r)}var o}function Xr(t,e,n){return e&&Wr(t.prototype,e),n&&Wr(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t}var $r=Xr((function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),void 0===e&&(e=null),this.readOnly=!1,this.verifyATN=null===e||e.verifyATN,this.generateRuleBypassTransitions=null!==e&&e.generateRuleBypassTransitions}));$r.defaultOptions=new $r,$r.defaultOptions.readOnly=!0;function Jr(t){return Jr="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Jr(t)}function Qr(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Jr(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Jr(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Jr(o)?o:String(o)),r)}var o}var Zr=function(){function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.actionType=e,this.isPositionDependent=!1}var e,n;return e=t,(n=[{key:"hashCode",value:function(){var t=new f;return this.updateHashCode(t),t.finish()}},{key:"updateHashCode",value:function(t){t.update(this.actionType)}},{key:"equals",value:function(t){return this===t}}])&&Qr(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function to(t){return to="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},to(t)}function eo(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==to(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==to(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===to(o)?o:String(o)),r)}var o}function no(t,e){return no=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},no(t,e)}function ro(t){return ro=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},ro(t)}var oo=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&no(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=ro(r);if(o){var n=ro(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===to(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),i.call(this,6)}return e=u,(n=[{key:"execute",value:function(t){t.skip()}},{key:"toString",value:function(){return"skip"}}])&&eo(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Zr);function io(t){return io="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},io(t)}function uo(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==io(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==io(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===io(o)?o:String(o)),r)}var o}function co(t,e){return co=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},co(t,e)}function ao(t){return ao=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},ao(t)}oo.INSTANCE=new oo;var lo=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&co(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=ao(r);if(o){var n=ao(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===io(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(e=i.call(this,0)).channel=t,e}return e=u,(n=[{key:"execute",value:function(t){t._channel=this.channel}},{key:"updateHashCode",value:function(t){t.update(this.actionType,this.channel)}},{key:"equals",value:function(t){return this===t||t instanceof u&&this.channel===t.channel}},{key:"toString",value:function(){return"channel("+this.channel+")"}}])&&uo(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Zr);function so(t){return so="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},so(t)}function fo(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==so(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==so(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===so(o)?o:String(o)),r)}var o}function po(t,e){return po=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},po(t,e)}function yo(t){return yo=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},yo(t)}var ho=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&po(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=yo(r);if(o){var n=yo(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===so(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e){var n;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(n=i.call(this,1)).ruleIndex=t,n.actionIndex=e,n.isPositionDependent=!0,n}return e=u,(n=[{key:"execute",value:function(t){t.action(null,this.ruleIndex,this.actionIndex)}},{key:"updateHashCode",value:function(t){t.update(this.actionType,this.ruleIndex,this.actionIndex)}},{key:"equals",value:function(t){return this===t||t instanceof u&&this.ruleIndex===t.ruleIndex&&this.actionIndex===t.actionIndex}}])&&fo(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Zr);function bo(t){return bo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},bo(t)}function vo(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==bo(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==bo(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===bo(o)?o:String(o)),r)}var o}function mo(t,e){return mo=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},mo(t,e)}function go(t){return go=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},go(t)}var So=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&mo(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=go(r);if(o){var n=go(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===bo(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),i.call(this,3)}return e=u,(n=[{key:"execute",value:function(t){t.more()}},{key:"toString",value:function(){return"more"}}])&&vo(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Zr);function Oo(t){return Oo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Oo(t)}function wo(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Oo(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Oo(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Oo(o)?o:String(o)),r)}var o}function _o(t,e){return _o=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},_o(t,e)}function Po(t){return Po=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Po(t)}So.INSTANCE=new So;var To=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&_o(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Po(r);if(o){var n=Po(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Oo(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(e=i.call(this,7)).type=t,e}return e=u,(n=[{key:"execute",value:function(t){t.type=this.type}},{key:"updateHashCode",value:function(t){t.update(this.actionType,this.type)}},{key:"equals",value:function(t){return this===t||t instanceof u&&this.type===t.type}},{key:"toString",value:function(){return"type("+this.type+")"}}])&&wo(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Zr);function Eo(t){return Eo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Eo(t)}function ko(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Eo(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Eo(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Eo(o)?o:String(o)),r)}var o}function jo(t,e){return jo=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},jo(t,e)}function xo(t){return xo=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},xo(t)}var Ro=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&jo(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=xo(r);if(o){var n=xo(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Eo(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(e=i.call(this,5)).mode=t,e}return e=u,(n=[{key:"execute",value:function(t){t.pushMode(this.mode)}},{key:"updateHashCode",value:function(t){t.update(this.actionType,this.mode)}},{key:"equals",value:function(t){return this===t||t instanceof u&&this.mode===t.mode}},{key:"toString",value:function(){return"pushMode("+this.mode+")"}}])&&ko(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Zr);function Co(t){return Co="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Co(t)}function Ao(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Co(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Co(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Co(o)?o:String(o)),r)}var o}function No(t,e){return No=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},No(t,e)}function Io(t){return Io=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Io(t)}var Lo=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&No(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Io(r);if(o){var n=Io(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Co(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),i.call(this,4)}return e=u,(n=[{key:"execute",value:function(t){t.popMode()}},{key:"toString",value:function(){return"popMode"}}])&&Ao(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Zr);function Do(t){return Do="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Do(t)}function Fo(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Do(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Do(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Do(o)?o:String(o)),r)}var o}function Bo(t,e){return Bo=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Bo(t,e)}function Mo(t){return Mo=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Mo(t)}Lo.INSTANCE=new Lo;var Uo=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Bo(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Mo(r);if(o){var n=Mo(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Do(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(e=i.call(this,2)).mode=t,e}return e=u,(n=[{key:"execute",value:function(t){t.mode(this.mode)}},{key:"updateHashCode",value:function(t){t.update(this.actionType,this.mode)}},{key:"equals",value:function(t){return this===t||t instanceof u&&this.mode===t.mode}},{key:"toString",value:function(){return"mode("+this.mode+")"}}])&&Fo(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Zr);function Vo(t){return Vo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Vo(t)}function zo(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Vo(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Vo(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Vo(o)?o:String(o)),r)}var o}function qo(t,e){var n=[];return n[t-1]=e,n.map((function(t){return e}))}var Ho=function(){function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),null==e&&(e=$r.defaultOptions),this.deserializationOptions=e,this.stateFactories=null,this.actionFactories=null}var e,n;return e=t,n=[{key:"deserialize",value:function(t){var e=this.reset(t);this.checkVersion(e),e&&this.skipUUID();var n=this.readATN();this.readStates(n,e),this.readRules(n,e),this.readModes(n);var r=[];return this.readSets(n,r,this.readInt.bind(this)),e&&this.readSets(n,r,this.readInt32.bind(this)),this.readEdges(n,r),this.readDecisions(n),this.readLexerActions(n,e),this.markPrecedenceDecisions(n),this.verifyATN(n),this.deserializationOptions.generateRuleBypassTransitions&&1===n.grammarType&&(this.generateRuleBypassTransitions(n),this.verifyATN(n)),n}},{key:"reset",value:function(t){if(3===(t.charCodeAt?t.charCodeAt(0):t[0])){var e=t.split("").map((function(t){var e=t.charCodeAt(0);return e>1?e-2:e+65534}));return e[0]=t.charCodeAt(0),this.data=e,this.pos=0,!0}return this.data=t,this.pos=0,!1}},{key:"skipUUID",value:function(){for(var t=0;t++<8;)this.readInt()}},{key:"checkVersion",value:function(t){var e=this.readInt();if(!t&&4!==e)throw"Could not deserialize ATN with version "+e+" (expected 4)."}},{key:"readATN",value:function(){var t=this.readInt(),e=this.readInt();return new Fe(t,e)}},{key:"readStates",value:function(t,e){for(var n,r,o,i=[],u=[],c=this.readInt(),a=0;a<c;a++){var l=this.readInt();if(l!==H.INVALID_TYPE){var s=this.readInt();e&&65535===s&&(s=-1);var f=this.stateFactory(l,s);if(l===H.LOOP_END){var p=this.readInt();i.push([f,p])}else if(f instanceof Ze){var y=this.readInt();u.push([f,y])}t.addState(f)}else t.addState(null)}for(n=0;n<i.length;n++)(r=i[n])[0].loopBackState=t.states[r[1]];for(n=0;n<u.length;n++)(r=u[n])[0].endState=t.states[r[1]];var h=this.readInt();for(n=0;n<h;n++)o=this.readInt(),t.states[o].nonGreedy=!0;var b=this.readInt();for(n=0;n<b;n++)o=this.readInt(),t.states[o].isPrecedenceRule=!0}},{key:"readRules",value:function(t,e){var n,r=this.readInt();for(0===t.grammarType&&(t.ruleToTokenType=qo(r,0)),t.ruleToStartState=qo(r,0),n=0;n<r;n++){var i=this.readInt();if(t.ruleToStartState[n]=t.states[i],0===t.grammarType){var u=this.readInt();e&&65535===u&&(u=o.EOF),t.ruleToTokenType[n]=u}}for(t.ruleToStopState=qo(r,0),n=0;n<t.states.length;n++){var c=t.states[n];c instanceof $&&(t.ruleToStopState[c.ruleIndex]=c,t.ruleToStartState[c.ruleIndex].stopState=c)}}},{key:"readModes",value:function(t){for(var e=this.readInt(),n=0;n<e;n++){var r=this.readInt();t.modeToStartState.push(t.states[r])}}},{key:"readSets",value:function(t,e,n){for(var r=this.readInt(),o=0;o<r;o++){var i=new V;e.push(i);var u=this.readInt();0!==this.readInt()&&i.addOne(-1);for(var c=0;c<u;c++){var a=n(),l=n();i.addRange(a,l)}}}},{key:"readEdges",value:function(t,e){var n,r,o,i,u,c=this.readInt();for(n=0;n<c;n++){var a=this.readInt(),l=this.readInt(),s=this.readInt(),f=this.readInt(),p=this.readInt(),y=this.readInt();i=this.edgeFactory(t,s,a,l,f,p,y,e),t.states[a].addTransition(i)}for(n=0;n<t.states.length;n++)for(o=t.states[n],r=0;r<o.transitions.length;r++){var h=o.transitions[r];if(h instanceof it){var b=-1;t.ruleToStartState[h.target.ruleIndex].isPrecedenceRule&&0===h.precedence&&(b=h.target.ruleIndex),i=new Er(h.followState,b),t.ruleToStopState[h.target.ruleIndex].addTransition(i)}}for(n=0;n<t.states.length;n++){if((o=t.states[n])instanceof Ze){if(null===o.endState)throw"IllegalState";if(null!==o.endState.startState)throw"IllegalState";o.endState.startState=o}if(o instanceof Rn)for(r=0;r<o.transitions.length;r++)(u=o.transitions[r].target)instanceof Wn&&(u.loopBackState=o);else if(o instanceof Dn)for(r=0;r<o.transitions.length;r++)(u=o.transitions[r].target)instanceof zn&&(u.loopBackState=o)}}},{key:"readDecisions",value:function(t){for(var e=this.readInt(),n=0;n<e;n++){var r=this.readInt(),o=t.states[r];t.decisionToState.push(o),o.decision=n}}},{key:"readLexerActions",value:function(t,e){if(0===t.grammarType){var n=this.readInt();t.lexerActions=qo(n,null);for(var r=0;r<n;r++){var o=this.readInt(),i=this.readInt();e&&65535===i&&(i=-1);var u=this.readInt();e&&65535===u&&(u=-1),t.lexerActions[r]=this.lexerActionFactory(o,i,u)}}}},{key:"generateRuleBypassTransitions",value:function(t){var e,n=t.ruleToStartState.length;for(e=0;e<n;e++)t.ruleToTokenType[e]=t.maxTokenType+e+1;for(e=0;e<n;e++)this.generateRuleBypassTransition(t,e)}},{key:"generateRuleBypassTransition",value:function(t,e){var n,r,o=new ur;o.ruleIndex=e,t.addState(o);var i=new un;i.ruleIndex=e,t.addState(i),o.endState=i,t.defineDecisionState(o),i.startState=o;var u=null,c=null;if(t.ruleToStartState[e].isPrecedenceRule){for(c=null,n=0;n<t.states.length;n++)if(r=t.states[n],this.stateIsEndStateFor(r,e)){c=r,u=r.loopBackState.transitions[0];break}if(null===u)throw"Couldn't identify final state of the precedence rule prefix section."}else c=t.ruleToStopState[e];for(n=0;n<t.states.length;n++){r=t.states[n];for(var a=0;a<r.transitions.length;a++){var l=r.transitions[a];l!==u&&l.target===c&&(l.target=i)}}for(var s=t.ruleToStartState[e],f=s.transitions.length;f>0;)o.addTransition(s.transitions[f-1]),s.transitions=s.transitions.slice(-1);t.ruleToStartState[e].addTransition(new Er(o)),i.addTransition(new Er(c));var p=new Ve;t.addState(p),p.addTransition(new fr(i,t.ruleToTokenType[e])),o.addTransition(new Er(p))}},{key:"stateIsEndStateFor",value:function(t,e){if(t.ruleIndex!==e)return null;if(!(t instanceof zn))return null;var n=t.transitions[t.transitions.length-1].target;return n instanceof pn&&n.epsilonOnlyTransitions&&n.transitions[0].target instanceof $?t:null}},{key:"markPrecedenceDecisions",value:function(t){for(var e=0;e<t.states.length;e++){var n=t.states[e];if(n instanceof zn&&t.ruleToStartState[n.ruleIndex].isPrecedenceRule){var r=n.transitions[n.transitions.length-1].target;r instanceof pn&&r.epsilonOnlyTransitions&&r.transitions[0].target instanceof $&&(n.isPrecedenceDecision=!0)}}}},{key:"verifyATN",value:function(t){if(this.deserializationOptions.verifyATN)for(var e=0;e<t.states.length;e++){var n=t.states[e];if(null!==n)if(this.checkCondition(n.epsilonOnlyTransitions||n.transitions.length<=1),n instanceof Wn)this.checkCondition(null!==n.loopBackState);else if(n instanceof zn)if(this.checkCondition(null!==n.loopBackState),this.checkCondition(2===n.transitions.length),n.transitions[0].target instanceof tr)this.checkCondition(n.transitions[1].target instanceof pn),this.checkCondition(!n.nonGreedy);else{if(!(n.transitions[0].target instanceof pn))throw"IllegalState";this.checkCondition(n.transitions[1].target instanceof tr),this.checkCondition(n.nonGreedy)}else n instanceof Dn?(this.checkCondition(1===n.transitions.length),this.checkCondition(n.transitions[0].target instanceof zn)):n instanceof pn?this.checkCondition(null!==n.loopBackState):n instanceof mn?this.checkCondition(null!==n.stopState):n instanceof Ze?this.checkCondition(null!==n.endState):n instanceof un?this.checkCondition(null!==n.startState):n instanceof Ge?this.checkCondition(n.transitions.length<=1||n.decision>=0):this.checkCondition(n.transitions.length<=1||n instanceof $)}}},{key:"checkCondition",value:function(t,e){if(!t)throw null==e&&(e="IllegalState"),e}},{key:"readInt",value:function(){return this.data[this.pos++]}},{key:"readInt32",value:function(){return this.readInt()|this.readInt()<<16}},{key:"edgeFactory",value:function(t,e,n,r,i,u,c,a){var l=t.states[r];switch(e){case tt.EPSILON:return new Er(l);case tt.RANGE:return new vr(l,0!==c?o.EOF:i,u);case tt.RULE:return new it(t.states[i],u,c,l);case tt.PREDICATE:return new Dr(l,i,u,0!==c);case tt.PRECEDENCE:return new Yr(l,i);case tt.ATOM:return new fr(l,0!==c?o.EOF:i);case tt.ACTION:return new Or(l,i,u,0!==c);case tt.SET:return new st(l,a[i]);case tt.NOT_SET:return new vt(l,a[i]);case tt.WILDCARD:return new Ot(l);default:throw"The specified transition type: "+e+" is not valid."}}},{key:"stateFactory",value:function(t,e){if(null===this.stateFactories){var n=[];n[H.INVALID_TYPE]=null,n[H.BASIC]=function(){return new Ve},n[H.RULE_START]=function(){return new mn},n[H.BLOCK_START]=function(){return new ur},n[H.PLUS_BLOCK_START]=function(){return new Wn},n[H.STAR_BLOCK_START]=function(){return new tr},n[H.TOKEN_START]=function(){return new Pn},n[H.RULE_STOP]=function(){return new $},n[H.BLOCK_END]=function(){return new un},n[H.STAR_LOOP_BACK]=function(){return new Dn},n[H.STAR_LOOP_ENTRY]=function(){return new zn},n[H.PLUS_LOOP_BACK]=function(){return new Rn},n[H.LOOP_END]=function(){return new pn},this.stateFactories=n}if(t>this.stateFactories.length||null===this.stateFactories[t])throw"The specified state type "+t+" is not valid.";var r=this.stateFactories[t]();if(null!==r)return r.ruleIndex=e,r}},{key:"lexerActionFactory",value:function(t,e,n){if(null===this.actionFactories){var r=[];r[0]=function(t,e){return new lo(t)},r[1]=function(t,e){return new ho(t,e)},r[2]=function(t,e){return new Uo(t)},r[3]=function(t,e){return So.INSTANCE},r[4]=function(t,e){return Lo.INSTANCE},r[5]=function(t,e){return new Ro(t)},r[6]=function(t,e){return oo.INSTANCE},r[7]=function(t,e){return new To(t)},this.actionFactories=r}if(t>this.actionFactories.length||null===this.actionFactories[t])throw"The specified lexer action type "+t+" is not valid.";return this.actionFactories[t](e,n)}}],n&&zo(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function Ko(t){return Ko="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ko(t)}function Yo(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Ko(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Ko(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Ko(o)?o:String(o)),r)}var o}var Go=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t)}var e,n;return e=t,(n=[{key:"syntaxError",value:function(t,e,n,r,o,i){}},{key:"reportAmbiguity",value:function(t,e,n,r,o,i,u){}},{key:"reportAttemptingFullContext",value:function(t,e,n,r,o,i){}},{key:"reportContextSensitivity",value:function(t,e,n,r,o,i){}}])&&Yo(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function Wo(t){return Wo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Wo(t)}function Xo(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Wo(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Wo(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Wo(o)?o:String(o)),r)}var o}function $o(t,e){return $o=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},$o(t,e)}function Jo(t){return Jo=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Jo(t)}var Qo=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&$o(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Jo(r);if(o){var n=Jo(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Wo(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),i.call(this)}return e=u,(n=[{key:"syntaxError",value:function(t,e,n,r,o,i){console.error("line "+n+":"+r+" "+o)}}])&&Xo(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Go);function Zo(t){return Zo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Zo(t)}function ti(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Zo(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Zo(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Zo(o)?o:String(o)),r)}var o}function ei(t,e){return ei=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},ei(t,e)}function ni(t,e){if(e&&("object"===Zo(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return ri(t)}function ri(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function oi(t){return oi=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},oi(t)}Qo.INSTANCE=new Qo;var ii=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&ei(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=oi(r);if(o){var n=oi(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return ni(this,t)});function u(t){var e;if(function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),e=i.call(this),null===t)throw"delegates";return e.delegates=t,ni(e,ri(e))}return e=u,n=[{key:"syntaxError",value:function(t,e,n,r,o,i){this.delegates.map((function(u){return u.syntaxError(t,e,n,r,o,i)}))}},{key:"reportAmbiguity",value:function(t,e,n,r,o,i,u){this.delegates.map((function(c){return c.reportAmbiguity(t,e,n,r,o,i,u)}))}},{key:"reportAttemptingFullContext",value:function(t,e,n,r,o,i){this.delegates.map((function(u){return u.reportAttemptingFullContext(t,e,n,r,o,i)}))}},{key:"reportContextSensitivity",value:function(t,e,n,r,o,i){this.delegates.map((function(u){return u.reportContextSensitivity(t,e,n,r,o,i)}))}}],n&&ti(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Go);function ui(t){return ui="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ui(t)}function ci(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==ui(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==ui(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===ui(o)?o:String(o)),r)}var o}var ai=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this._listeners=[Qo.INSTANCE],this._interp=null,this._stateNumber=-1}var e,n;return e=t,n=[{key:"checkVersion",value:function(t){var e="4.13.0";e!==t&&console.log("ANTLR runtime and generated code versions disagree: "+e+"!="+t)}},{key:"addErrorListener",value:function(t){this._listeners.push(t)}},{key:"removeErrorListeners",value:function(){this._listeners=[]}},{key:"getLiteralNames",value:function(){return Object.getPrototypeOf(this).constructor.literalNames||[]}},{key:"getSymbolicNames",value:function(){return Object.getPrototypeOf(this).constructor.symbolicNames||[]}},{key:"getTokenNames",value:function(){if(!this.tokenNames){var t=this.getLiteralNames(),e=this.getSymbolicNames(),n=t.length>e.length?t.length:e.length;this.tokenNames=[];for(var r=0;r<n;r++)this.tokenNames[r]=t[r]||e[r]||"<INVALID"}return this.tokenNames}},{key:"getTokenTypeMap",value:function(){var t=this.getTokenNames();if(null===t)throw"The current recognizer does not provide a list of token names.";var e=this.tokenTypeMapCache[t];return void 0===e&&(e=t.reduce((function(t,e,n){t[e]=n})),e.EOF=o.EOF,this.tokenTypeMapCache[t]=e),e}},{key:"getRuleIndexMap",value:function(){var t=this.ruleNames;if(null===t)throw"The current recognizer does not provide a list of rule names.";var e=this.ruleIndexMapCache[t];return void 0===e&&(e=t.reduce((function(t,e,n){t[e]=n})),this.ruleIndexMapCache[t]=e),e}},{key:"getTokenType",value:function(t){var e=this.getTokenTypeMap()[t];return void 0!==e?e:o.INVALID_TYPE}},{key:"getErrorHeader",value:function(t){return"line "+t.getOffendingToken().line+":"+t.getOffendingToken().column}},{key:"getTokenErrorDisplay",value:function(t){if(null===t)return"<no token>";var e=t.text;return null===e&&(e=t.type===o.EOF?"<EOF>":"<"+t.type+">"),"'"+(e=e.replace("\n","\\n").replace("\r","\\r").replace("\t","\\t"))+"'"}},{key:"getErrorListenerDispatch",value:function(){return new ii(this._listeners)}},{key:"sempred",value:function(t,e,n){return!0}},{key:"precpred",value:function(t,e){return!0}},{key:"atn",get:function(){return this._interp.atn}},{key:"state",get:function(){return this._stateNumber},set:function(t){this._stateNumber=t}}],n&&ci(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function li(t){return li="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},li(t)}function si(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==li(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==li(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===li(o)?o:String(o)),r)}var o}function fi(t,e){return fi=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},fi(t,e)}function pi(t){return pi=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},pi(t)}ai.tokenTypeMapCache={},ai.ruleIndexMapCache={};var yi=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&fi(t,e)}(c,t);var e,n,r,i,u=(r=c,i=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=pi(r);if(i){var n=pi(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===li(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function c(t,e,n,r,i){var a;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,c),(a=u.call(this)).source=void 0!==t?t:c.EMPTY_SOURCE,a.type=void 0!==e?e:null,a.channel=void 0!==n?n:o.DEFAULT_CHANNEL,a.start=void 0!==r?r:-1,a.stop=void 0!==i?i:-1,a.tokenIndex=-1,null!==a.source[0]?(a.line=t[0].line,a.column=t[0].column):a.column=-1,a}return e=c,(n=[{key:"clone",value:function(){var t=new c(this.source,this.type,this.channel,this.start,this.stop);return t.tokenIndex=this.tokenIndex,t.line=this.line,t.column=this.column,t.text=this.text,t}},{key:"cloneWithType",value:function(t){var e=new c(this.source,t,this.channel,this.start,this.stop);return e.tokenIndex=this.tokenIndex,e.line=this.line,e.column=this.column,t===o.EOF&&(e.text=""),e}},{key:"toString",value:function(){var t=this.text;return t=null!==t?t.replace(/\n/g,"\\n").replace(/\r/g,"\\r").replace(/\t/g,"\\t"):"<no text>","[@"+this.tokenIndex+","+this.start+":"+this.stop+"='"+t+"',<"+this.type+">"+(this.channel>0?",channel="+this.channel:"")+","+this.line+":"+this.column+"]"}},{key:"text",get:function(){if(null!==this._text)return this._text;var t=this.getInputStream();if(null===t)return null;var e=t.size;return this.start<e&&this.stop<e?t.getText(this.start,this.stop):"<EOF>"},set:function(t){this._text=t}}])&&si(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),c}(o);function hi(t){return hi="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},hi(t)}function bi(t,e){return bi=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},bi(t,e)}function vi(t){return vi=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},vi(t)}function di(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==hi(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==hi(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===hi(o)?o:String(o)),r)}var o}function mi(t,e,n){return e&&di(t.prototype,e),n&&di(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t}function gi(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}yi.EMPTY_SOURCE=[null,null];var Si=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&bi(t,e)}(o,t);var e,n,r=(e=o,n=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,r=vi(e);if(n){var o=vi(this).constructor;t=Reflect.construct(r,arguments,o)}else t=r.apply(this,arguments);return function(t,e){if(e&&("object"===hi(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function o(t){var e;return gi(this,o),(e=r.call(this)).copyText=void 0!==t&&t,e}return mi(o,[{key:"create",value:function(t,e,n,r,o,i,u,c){var a=new yi(t,e,r,o,i);return a.line=u,a.column=c,null!==n?a.text=n:this.copyText&&null!==t[1]&&(a.text=t[1].getText(o,i)),a}},{key:"createThin",value:function(t,e){var n=new yi(null,t);return n.text=e,n}}]),o}(mi((function t(){gi(this,t)})));function Oi(t){return Oi="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Oi(t)}function wi(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Oi(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Oi(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Oi(o)?o:String(o)),r)}var o}function _i(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function Pi(t){var e="function"==typeof Map?new Map:void 0;return Pi=function(t){if(null===t||(n=t,-1===Function.toString.call(n).indexOf("[native code]")))return t;var n;if("function"!=typeof t)throw new TypeError("Super expression must either be null or a function");if(void 0!==e){if(e.has(t))return e.get(t);e.set(t,r)}function r(){return Ti(t,arguments,ji(this).constructor)}return r.prototype=Object.create(t.prototype,{constructor:{value:r,enumerable:!1,writable:!0,configurable:!0}}),ki(r,t)},Pi(t)}function Ti(t,e,n){return Ti=Ei()?Reflect.construct.bind():function(t,e,n){var r=[null];r.push.apply(r,e);var o=new(Function.bind.apply(t,r));return n&&ki(o,n.prototype),o},Ti.apply(null,arguments)}function Ei(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}function ki(t,e){return ki=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},ki(t,e)}function ji(t){return ji=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},ji(t)}Si.DEFAULT=new Si;var xi=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&ki(t,e)}(u,t);var e,n,r,o,i=(r=u,o=Ei(),function(){var t,e=ji(r);if(o){var n=ji(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Oi(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return _i(t)}(this,t)});function u(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),e=i.call(this,t.message),Error.captureStackTrace&&Error.captureStackTrace(_i(e),u),e.message=t.message,e.recognizer=t.recognizer,e.input=t.input,e.ctx=t.ctx,e.offendingToken=null,e.offendingState=-1,null!==e.recognizer&&(e.offendingState=e.recognizer.state),e}return e=u,(n=[{key:"getExpectedTokens",value:function(){return null!==this.recognizer?this.recognizer.atn.getExpectedTokens(this.offendingState,this.ctx):null}},{key:"toString",value:function(){return this.message}}])&&wi(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Pi(Error));function Ri(t){return Ri="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ri(t)}function Ci(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Ri(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Ri(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Ri(o)?o:String(o)),r)}var o}function Ai(t,e){return Ai=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Ai(t,e)}function Ni(t){return Ni=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Ni(t)}var Ii=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Ai(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Ni(r);if(o){var n=Ni(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Ri(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e,n,r){var o;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(o=i.call(this,{message:"",recognizer:t,input:e,ctx:null})).startIndex=n,o.deadEndConfigs=r,o}return e=u,(n=[{key:"toString",value:function(){var t="";return this.startIndex>=0&&this.startIndex<this.input.size&&(t=this.input.getText(new B(this.startIndex,this.startIndex))),"LexerNoViableAltException"+t}}])&&Ci(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(xi);function Li(t){return Li="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Li(t)}function Di(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Li(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Li(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Li(o)?o:String(o)),r)}var o}function Fi(t,e){return Fi=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Fi(t,e)}function Bi(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function Mi(t){return Mi=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Mi(t)}var Ui=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Fi(t,e)}(c,t);var e,n,r,i,u=(r=c,i=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Mi(r);if(i){var n=Mi(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Li(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return Bi(t)}(this,t)});function c(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,c),(e=u.call(this))._input=t,e._factory=Si.DEFAULT,e._tokenFactorySourcePair=[Bi(e),t],e._interp=null,e._token=null,e._tokenStartCharIndex=-1,e._tokenStartLine=-1,e._tokenStartColumn=-1,e._hitEOF=!1,e._channel=o.DEFAULT_CHANNEL,e._type=o.INVALID_TYPE,e._modeStack=[],e._mode=c.DEFAULT_MODE,e._text=null,e}return e=c,n=[{key:"reset",value:function(){null!==this._input&&this._input.seek(0),this._token=null,this._type=o.INVALID_TYPE,this._channel=o.DEFAULT_CHANNEL,this._tokenStartCharIndex=-1,this._tokenStartColumn=-1,this._tokenStartLine=-1,this._text=null,this._hitEOF=!1,this._mode=c.DEFAULT_MODE,this._modeStack=[],this._interp.reset()}},{key:"nextToken",value:function(){if(null===this._input)throw"nextToken requires a non-null input stream.";var t=this._input.mark();try{for(;;){if(this._hitEOF)return this.emitEOF(),this._token;this._token=null,this._channel=o.DEFAULT_CHANNEL,this._tokenStartCharIndex=this._input.index,this._tokenStartColumn=this._interp.column,this._tokenStartLine=this._interp.line,this._text=null;for(var e=!1;;){this._type=o.INVALID_TYPE;var n=c.SKIP;try{n=this._interp.match(this._input,this._mode)}catch(t){if(!(t instanceof xi))throw console.log(t.stack),t;this.notifyListeners(t),this.recover(t)}if(this._input.LA(1)===o.EOF&&(this._hitEOF=!0),this._type===o.INVALID_TYPE&&(this._type=n),this._type===c.SKIP){e=!0;break}if(this._type!==c.MORE)break}if(!e)return null===this._token&&this.emit(),this._token}}finally{this._input.release(t)}}},{key:"skip",value:function(){this._type=c.SKIP}},{key:"more",value:function(){this._type=c.MORE}},{key:"mode",value:function(t){this._mode=t}},{key:"pushMode",value:function(t){this._interp.debug&&console.log("pushMode "+t),this._modeStack.push(this._mode),this.mode(t)}},{key:"popMode",value:function(){if(0===this._modeStack.length)throw"Empty Stack";return this._interp.debug&&console.log("popMode back to "+this._modeStack.slice(0,-1)),this.mode(this._modeStack.pop()),this._mode}},{key:"emitToken",value:function(t){this._token=t}},{key:"emit",value:function(){var t=this._factory.create(this._tokenFactorySourcePair,this._type,this._text,this._channel,this._tokenStartCharIndex,this.getCharIndex()-1,this._tokenStartLine,this._tokenStartColumn);return this.emitToken(t),t}},{key:"emitEOF",value:function(){var t=this.column,e=this.line,n=this._factory.create(this._tokenFactorySourcePair,o.EOF,null,o.DEFAULT_CHANNEL,this._input.index,this._input.index-1,e,t);return this.emitToken(n),n}},{key:"getCharIndex",value:function(){return this._input.index}},{key:"getAllTokens",value:function(){for(var t=[],e=this.nextToken();e.type!==o.EOF;)t.push(e),e=this.nextToken();return t}},{key:"notifyListeners",value:function(t){var e=this._tokenStartCharIndex,n=this._input.index,r=this._input.getText(e,n),o="token recognition error at: '"+this.getErrorDisplay(r)+"'";this.getErrorListenerDispatch().syntaxError(this,null,this._tokenStartLine,this._tokenStartColumn,o,t)}},{key:"getErrorDisplay",value:function(t){for(var e=[],n=0;n<t.length;n++)e.push(t[n]);return e.join("")}},{key:"getErrorDisplayForChar",value:function(t){return t.charCodeAt(0)===o.EOF?"<EOF>":"\n"===t?"\\n":"\t"===t?"\\t":"\r"===t?"\\r":t}},{key:"getCharErrorDisplay",value:function(t){return"'"+this.getErrorDisplayForChar(t)+"'"}},{key:"recover",value:function(t){this._input.LA(1)!==o.EOF&&(t instanceof Ii?this._interp.consume(this._input):this._input.consume())}},{key:"inputStream",get:function(){return this._input},set:function(t){this._input=null,this._tokenFactorySourcePair=[this,this._input],this.reset(),this._input=t,this._tokenFactorySourcePair=[this,this._input]}},{key:"sourceName",get:function(){return this._input.sourceName}},{key:"type",get:function(){return this._type},set:function(t){this._type=t}},{key:"line",get:function(){return this._interp.line},set:function(t){this._interp.line=t}},{key:"column",get:function(){return this._interp.column},set:function(t){this._interp.column=t}},{key:"text",get:function(){return null!==this._text?this._text:this._interp.getText(this._input)},set:function(t){this._text=t}}],n&&Di(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),c}(ai);function Vi(t){return Vi="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Vi(t)}function zi(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Vi(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Vi(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Vi(o)?o:String(o)),r)}var o}function qi(t){return t.hashCodeForConfigSet()}function Hi(t,e){return t===e||null!==t&&null!==e&&t.equalsForConfigSet(e)}Ui.DEFAULT_MODE=0,Ui.MORE=-2,Ui.SKIP=-3,Ui.DEFAULT_TOKEN_CHANNEL=o.DEFAULT_CHANNEL,Ui.HIDDEN=o.HIDDEN_CHANNEL,Ui.MIN_CHAR_VALUE=0,Ui.MAX_CHAR_VALUE=1114111;var Ki=function(){function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.configLookup=new g(qi,Hi),this.fullCtx=void 0===e||e,this.readOnly=!1,this.configs=[],this.uniqueAlt=0,this.conflictingAlts=null,this.hasSemanticContext=!1,this.dipsIntoOuterContext=!1,this.cachedHashCode=-1}var e,n;return e=t,n=[{key:"add",value:function(t,e){if(void 0===e&&(e=null),this.readOnly)throw"This set is readonly";t.semanticContext!==j.NONE&&(this.hasSemanticContext=!0),t.reachesIntoOuterContext>0&&(this.dipsIntoOuterContext=!0);var n=this.configLookup.add(t);if(n===t)return this.cachedHashCode=-1,this.configs.push(t),!0;var r=!this.fullCtx,o=je(n.context,t.context,r,e);return n.reachesIntoOuterContext=Math.max(n.reachesIntoOuterContext,t.reachesIntoOuterContext),t.precedenceFilterSuppressed&&(n.precedenceFilterSuppressed=!0),n.context=o,!0}},{key:"getStates",value:function(){for(var t=new g,e=0;e<this.configs.length;e++)t.add(this.configs[e].state);return t}},{key:"getPredicates",value:function(){for(var t=[],e=0;e<this.configs.length;e++){var n=this.configs[e].semanticContext;n!==j.NONE&&t.push(n.semanticContext)}return t}},{key:"optimizeConfigs",value:function(t){if(this.readOnly)throw"This set is readonly";if(0!==this.configLookup.length)for(var e=0;e<this.configs.length;e++){var n=this.configs[e];n.context=t.getCachedContext(n.context)}}},{key:"addAll",value:function(t){for(var e=0;e<t.length;e++)this.add(t[e]);return!1}},{key:"equals",value:function(e){return this===e||e instanceof t&&i(this.configs,e.configs)&&this.fullCtx===e.fullCtx&&this.uniqueAlt===e.uniqueAlt&&this.conflictingAlts===e.conflictingAlts&&this.hasSemanticContext===e.hasSemanticContext&&this.dipsIntoOuterContext===e.dipsIntoOuterContext}},{key:"hashCode",value:function(){var t=new f;return t.update(this.configs),t.finish()}},{key:"updateHashCode",value:function(t){this.readOnly?(-1===this.cachedHashCode&&(this.cachedHashCode=this.hashCode()),t.update(this.cachedHashCode)):t.update(this.hashCode())}},{key:"isEmpty",value:function(){return 0===this.configs.length}},{key:"contains",value:function(t){if(null===this.configLookup)throw"This method is not implemented for readonly sets.";return this.configLookup.contains(t)}},{key:"containsFast",value:function(t){if(null===this.configLookup)throw"This method is not implemented for readonly sets.";return this.configLookup.containsFast(t)}},{key:"clear",value:function(){if(this.readOnly)throw"This set is readonly";this.configs=[],this.cachedHashCode=-1,this.configLookup=new g}},{key:"setReadonly",value:function(t){this.readOnly=t,t&&(this.configLookup=null)}},{key:"toString",value:function(){return b(this.configs)+(this.hasSemanticContext?",hasSemanticContext="+this.hasSemanticContext:"")+(this.uniqueAlt!==Fe.INVALID_ALT_NUMBER?",uniqueAlt="+this.uniqueAlt:"")+(null!==this.conflictingAlts?",conflictingAlts="+this.conflictingAlts:"")+(this.dipsIntoOuterContext?",dipsIntoOuterContext":"")}},{key:"items",get:function(){return this.configs}},{key:"length",get:function(){return this.configs.length}}],n&&zi(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function Yi(t){return Yi="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Yi(t)}function Gi(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Yi(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Yi(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Yi(o)?o:String(o)),r)}var o}var Wi=function(){function t(e,n){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),null===e&&(e=-1),null===n&&(n=new Ki),this.stateNumber=e,this.configs=n,this.edges=null,this.isAcceptState=!1,this.prediction=0,this.lexerActionExecutor=null,this.requiresFullContext=!1,this.predicates=null,this}var e,n;return e=t,n=[{key:"getAltSet",value:function(){var t=new g;if(null!==this.configs)for(var e=0;e<this.configs.length;e++){var n=this.configs[e];t.add(n.alt)}return 0===t.length?null:t}},{key:"equals",value:function(e){return this===e||e instanceof t&&this.configs.equals(e.configs)}},{key:"toString",value:function(){var t=this.stateNumber+":"+this.configs;return this.isAcceptState&&(t+="=>",null!==this.predicates?t+=this.predicates:t+=this.prediction),t}},{key:"hashCode",value:function(){var t=new f;return t.update(this.configs),t.finish()}}],n&&Gi(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function Xi(t){return Xi="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Xi(t)}function $i(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Xi(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Xi(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Xi(o)?o:String(o)),r)}var o}var Ji=function(){function t(e,n){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.atn=e,this.sharedContextCache=n,this}var e,n;return e=t,n=[{key:"getCachedContext",value:function(t){if(null===this.sharedContextCache)return t;var e=new Te;return ke(t,this.sharedContextCache,e)}}],n&&$i(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function Qi(t){return Qi="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Qi(t)}function Zi(t,e){return Zi=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Zi(t,e)}function tu(t){return tu=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},tu(t)}Ji.ERROR=new Wi(2147483647,new Ki);var eu=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Zi(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=tu(n);if(r){var o=tu(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Qi(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(t=o.call(this)).configLookup=new g,t}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(Ki);function nu(t){return nu="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},nu(t)}function ru(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==nu(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==nu(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===nu(o)?o:String(o)),r)}var o}function ou(){return ou="undefined"!=typeof Reflect&&Reflect.get?Reflect.get.bind():function(t,e,n){var r=function(t,e){for(;!Object.prototype.hasOwnProperty.call(t,e)&&null!==(t=au(t)););return t}(t,e);if(r){var o=Object.getOwnPropertyDescriptor(r,e);return o.get?o.get.call(arguments.length<3?t:n):o.value}},ou.apply(this,arguments)}function iu(t,e){return iu=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},iu(t,e)}function uu(t,e){if(e&&("object"===nu(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return cu(t)}function cu(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function au(t){return au=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},au(t)}var lu=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&iu(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=au(r);if(o){var n=au(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return uu(this,t)});function u(t,e){var n;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),n=i.call(this,t,e);var r=t.lexerActionExecutor||null;return n.lexerActionExecutor=r||(null!==e?e.lexerActionExecutor:null),n.passedThroughNonGreedyDecision=null!==e&&n.checkNonGreedyDecision(e,n.state),n.hashCodeForConfigSet=u.prototype.hashCode,n.equalsForConfigSet=u.prototype.equals,uu(n,cu(n))}return e=u,(n=[{key:"updateHashCode",value:function(t){t.update(this.state.stateNumber,this.alt,this.context,this.semanticContext,this.passedThroughNonGreedyDecision,this.lexerActionExecutor)}},{key:"equals",value:function(t){return this===t||t instanceof u&&this.passedThroughNonGreedyDecision===t.passedThroughNonGreedyDecision&&(this.lexerActionExecutor?this.lexerActionExecutor.equals(t.lexerActionExecutor):!t.lexerActionExecutor)&&ou(au(u.prototype),"equals",this).call(this,t)}},{key:"checkNonGreedyDecision",value:function(t,e){return t.passedThroughNonGreedyDecision||e instanceof Ge&&e.nonGreedy}}])&&ru(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(L);function su(t){return su="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},su(t)}function fu(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==su(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==su(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===su(o)?o:String(o)),r)}var o}function pu(t,e){return pu=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},pu(t,e)}function yu(t){return yu=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},yu(t)}var hu=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&pu(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=yu(r);if(o){var n=yu(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===su(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e){var n;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(n=i.call(this,e.actionType)).offset=t,n.action=e,n.isPositionDependent=!0,n}return e=u,(n=[{key:"execute",value:function(t){this.action.execute(t)}},{key:"updateHashCode",value:function(t){t.update(this.actionType,this.offset,this.action)}},{key:"equals",value:function(t){return this===t||t instanceof u&&this.offset===t.offset&&this.action===t.action}}])&&fu(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Zr);function bu(t){return bu="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},bu(t)}function vu(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==bu(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==bu(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===bu(o)?o:String(o)),r)}var o}var du=function(){function t(e){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.lexerActions=null===e?[]:e,this.cachedHashCode=f.hashStuff(e),this}var e,n,r;return e=t,n=[{key:"fixOffsetBeforeMatch",value:function(e){for(var n=null,r=0;r<this.lexerActions.length;r++)!this.lexerActions[r].isPositionDependent||this.lexerActions[r]instanceof hu||(null===n&&(n=this.lexerActions.concat([])),n[r]=new hu(e,this.lexerActions[r]));return null===n?this:new t(n)}},{key:"execute",value:function(t,e,n){var r=!1,o=e.index;try{for(var i=0;i<this.lexerActions.length;i++){var u=this.lexerActions[i];if(u instanceof hu){var c=u.offset;e.seek(n+c),u=u.action,r=n+c!==o}else u.isPositionDependent&&(e.seek(o),r=!1);u.execute(t)}}finally{r&&e.seek(o)}}},{key:"hashCode",value:function(){return this.cachedHashCode}},{key:"updateHashCode",value:function(t){t.update(this.cachedHashCode)}},{key:"equals",value:function(e){if(this===e)return!0;if(e instanceof t){if(this.cachedHashCode!=e.cachedHashCode)return!1;if(this.lexerActions.length!=e.lexerActions.length)return!1;for(var n=this.lexerActions.length,r=0;r<n;++r)if(!this.lexerActions[r].equals(e.lexerActions[r]))return!1;return!0}return!1}}],r=[{key:"append",value:function(e,n){return new t(null===e?[n]:e.lexerActions.concat([n]))}}],n&&vu(e.prototype,n),r&&vu(e,r),Object.defineProperty(e,"prototype",{writable:!1}),t}();function mu(t,e){return mu=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},mu(t,e)}function gu(t){return gu=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},gu(t)}function Su(t){return Su="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Su(t)}function Ou(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function wu(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Su(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Su(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Su(o)?o:String(o)),r)}var o}function _u(t,e,n){return e&&wu(t.prototype,e),n&&wu(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t}function Pu(t){t.index=-1,t.line=0,t.column=-1,t.dfaState=null}var Tu=function(){function t(){Ou(this,t),Pu(this)}return _u(t,[{key:"reset",value:function(){Pu(this)}}]),t}(),Eu=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&mu(t,e)}(i,t);var e,n,r=(e=i,n=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,r=gu(e);if(n){var o=gu(this).constructor;t=Reflect.construct(r,arguments,o)}else t=r.apply(this,arguments);return function(t,e){if(e&&("object"===Su(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(t,e,n,o){var u;return Ou(this,i),(u=r.call(this,e,o)).decisionToDFA=n,u.recog=t,u.startIndex=-1,u.line=1,u.column=0,u.mode=Ui.DEFAULT_MODE,u.prevAccept=new Tu,u}return _u(i,[{key:"copyState",value:function(t){this.column=t.column,this.line=t.line,this.mode=t.mode,this.startIndex=t.startIndex}},{key:"match",value:function(t,e){this.mode=e;var n=t.mark();try{this.startIndex=t.index,this.prevAccept.reset();var r=this.decisionToDFA[e];return null===r.s0?this.matchATN(t):this.execATN(t,r.s0)}finally{t.release(n)}}},{key:"reset",value:function(){this.prevAccept.reset(),this.startIndex=-1,this.line=1,this.column=0,this.mode=Ui.DEFAULT_MODE}},{key:"matchATN",value:function(t){var e=this.atn.modeToStartState[this.mode];i.debug&&console.log("matchATN mode "+this.mode+" start: "+e);var n=this.mode,r=this.computeStartState(t,e),o=r.hasSemanticContext;r.hasSemanticContext=!1;var u=this.addDFAState(r);o||(this.decisionToDFA[this.mode].s0=u);var c=this.execATN(t,u);return i.debug&&console.log("DFA after matchATN: "+this.decisionToDFA[n].toLexerString()),c}},{key:"execATN",value:function(t,e){i.debug&&console.log("start state closure="+e.configs),e.isAcceptState&&this.captureSimState(this.prevAccept,t,e);for(var n=t.LA(1),r=e;;){i.debug&&console.log("execATN loop starting closure: "+r.configs);var u=this.getExistingTargetState(r,n);if(null===u&&(u=this.computeTargetState(t,r,n)),u===Ji.ERROR)break;if(n!==o.EOF&&this.consume(t),u.isAcceptState&&(this.captureSimState(this.prevAccept,t,u),n===o.EOF))break;n=t.LA(1),r=u}return this.failOrAccept(this.prevAccept,t,r.configs,n)}},{key:"getExistingTargetState",value:function(t,e){if(null===t.edges||e<i.MIN_DFA_EDGE||e>i.MAX_DFA_EDGE)return null;var n=t.edges[e-i.MIN_DFA_EDGE];return void 0===n&&(n=null),i.debug&&null!==n&&console.log("reuse state "+t.stateNumber+" edge to "+n.stateNumber),n}},{key:"computeTargetState",value:function(t,e,n){var r=new eu;return this.getReachableConfigSet(t,e.configs,r,n),0===r.items.length?(r.hasSemanticContext||this.addDFAEdge(e,n,Ji.ERROR),Ji.ERROR):this.addDFAEdge(e,n,null,r)}},{key:"failOrAccept",value:function(t,e,n,r){if(null!==this.prevAccept.dfaState){var i=t.dfaState.lexerActionExecutor;return this.accept(e,i,this.startIndex,t.index,t.line,t.column),t.dfaState.prediction}if(r===o.EOF&&e.index===this.startIndex)return o.EOF;throw new Ii(this.recog,e,this.startIndex,n)}},{key:"getReachableConfigSet",value:function(t,e,n,r){for(var u=Fe.INVALID_ALT_NUMBER,c=0;c<e.items.length;c++){var a=e.items[c],l=a.alt===u;if(!l||!a.passedThroughNonGreedyDecision){i.debug&&console.log("testing %s at %s\n",this.getTokenName(r),a.toString(this.recog,!0));for(var s=0;s<a.state.transitions.length;s++){var f=a.state.transitions[s],p=this.getReachableTarget(f,r);if(null!==p){var y=a.lexerActionExecutor;null!==y&&(y=y.fixOffsetBeforeMatch(t.index-this.startIndex));var h=r===o.EOF,b=new lu({state:p,lexerActionExecutor:y},a);this.closure(t,b,n,l,!0,h)&&(u=a.alt)}}}}}},{key:"accept",value:function(t,e,n,r,o,u){i.debug&&console.log("ACTION %s\n",e),t.seek(r),this.line=o,this.column=u,null!==e&&null!==this.recog&&e.execute(this.recog,t,n)}},{key:"getReachableTarget",value:function(t,e){return t.matches(e,0,Ui.MAX_CHAR_VALUE)?t.target:null}},{key:"computeStartState",value:function(t,e){for(var n=oe.EMPTY,r=new eu,o=0;o<e.transitions.length;o++){var i=e.transitions[o].target,u=new lu({state:i,alt:o+1,context:n},null);this.closure(t,u,r,!1,!1,!1)}return r}},{key:"closure",value:function(t,e,n,r,o,u){var c=null;if(i.debug&&console.log("closure("+e.toString(this.recog,!0)+")"),e.state instanceof $){if(i.debug&&(null!==this.recog?console.log("closure at %s rule stop %s\n",this.recog.ruleNames[e.state.ruleIndex],e):console.log("closure at rule stop %s\n",e)),null===e.context||e.context.hasEmptyPath()){if(null===e.context||e.context.isEmpty())return n.add(e),!0;n.add(new lu({state:e.state,context:oe.EMPTY},e)),r=!0}if(null!==e.context&&!e.context.isEmpty())for(var a=0;a<e.context.length;a++)if(e.context.getReturnState(a)!==oe.EMPTY_RETURN_STATE){var l=e.context.getParent(a),s=this.atn.states[e.context.getReturnState(a)];c=new lu({state:s,context:l},e),r=this.closure(t,c,n,r,o,u)}return r}e.state.epsilonOnlyTransitions||r&&e.passedThroughNonGreedyDecision||n.add(e);for(var f=0;f<e.state.transitions.length;f++){var p=e.state.transitions[f];null!==(c=this.getEpsilonTarget(t,e,p,n,o,u))&&(r=this.closure(t,c,n,r,o,u))}return r}},{key:"getEpsilonTarget",value:function(t,e,n,r,u,c){var a=null;if(n.serializationType===tt.RULE){var l=ve.create(e.context,n.followState.stateNumber);a=new lu({state:n.target,context:l},e)}else{if(n.serializationType===tt.PRECEDENCE)throw"Precedence predicates are not supported in lexers.";if(n.serializationType===tt.PREDICATE)i.debug&&console.log("EVAL rule "+n.ruleIndex+":"+n.predIndex),r.hasSemanticContext=!0,this.evaluatePredicate(t,n.ruleIndex,n.predIndex,u)&&(a=new lu({state:n.target},e));else if(n.serializationType===tt.ACTION)if(null===e.context||e.context.hasEmptyPath()){var s=du.append(e.lexerActionExecutor,this.atn.lexerActions[n.actionIndex]);a=new lu({state:n.target,lexerActionExecutor:s},e)}else a=new lu({state:n.target},e);else n.serializationType===tt.EPSILON?a=new lu({state:n.target},e):n.serializationType!==tt.ATOM&&n.serializationType!==tt.RANGE&&n.serializationType!==tt.SET||c&&n.matches(o.EOF,0,Ui.MAX_CHAR_VALUE)&&(a=new lu({state:n.target},e))}return a}},{key:"evaluatePredicate",value:function(t,e,n,r){if(null===this.recog)return!0;if(!r)return this.recog.sempred(null,e,n);var o=this.column,i=this.line,u=t.index,c=t.mark();try{return this.consume(t),this.recog.sempred(null,e,n)}finally{this.column=o,this.line=i,t.seek(u),t.release(c)}}},{key:"captureSimState",value:function(t,e,n){t.index=e.index,t.line=this.line,t.column=this.column,t.dfaState=n}},{key:"addDFAEdge",value:function(t,e,n,r){if(void 0===n&&(n=null),void 0===r&&(r=null),null===n&&null!==r){var o=r.hasSemanticContext;if(r.hasSemanticContext=!1,n=this.addDFAState(r),o)return n}return e<i.MIN_DFA_EDGE||e>i.MAX_DFA_EDGE||(i.debug&&console.log("EDGE "+t+" -> "+n+" upon "+e),null===t.edges&&(t.edges=[]),t.edges[e-i.MIN_DFA_EDGE]=n),n}},{key:"addDFAState",value:function(t){for(var e=new Wi(null,t),n=null,r=0;r<t.items.length;r++){var o=t.items[r];if(o.state instanceof $){n=o;break}}null!==n&&(e.isAcceptState=!0,e.lexerActionExecutor=n.lexerActionExecutor,e.prediction=this.atn.ruleToTokenType[n.state.ruleIndex]);var i=this.decisionToDFA[this.mode],u=i.states.get(e);if(null!==u)return u;var c=e;return c.stateNumber=i.states.length,t.setReadonly(!0),c.configs=t,i.states.add(c),c}},{key:"getDFA",value:function(t){return this.decisionToDFA[t]}},{key:"getText",value:function(t){return t.getText(this.startIndex,t.index-1)}},{key:"consume",value:function(t){t.LA(1)==="\n".charCodeAt(0)?(this.line+=1,this.column=0):this.column+=1,t.consume()}},{key:"getTokenName",value:function(t){return-1===t?"EOF":"'"+String.fromCharCode(t)+"'"}}]),i}(Ji);function ku(t){return ku="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ku(t)}function ju(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==ku(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==ku(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===ku(o)?o:String(o)),r)}var o}Eu.debug=!1,Eu.dfa_debug=!1,Eu.MIN_DFA_EDGE=0,Eu.MAX_DFA_EDGE=127;var xu=function(){function t(e,n){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.alt=n,this.pred=e}var e,n;return e=t,(n=[{key:"toString",value:function(){return"("+this.pred+", "+this.alt+")"}}])&&ju(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function Ru(t){return Ru="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ru(t)}function Cu(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Ru(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Ru(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Ru(o)?o:String(o)),r)}var o}var Au=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.data={}}var e,n;return e=t,(n=[{key:"get",value:function(t){return this.data["k-"+t]||null}},{key:"set",value:function(t,e){this.data["k-"+t]=e}},{key:"values",value:function(){var t=this;return Object.keys(this.data).filter((function(t){return t.startsWith("k-")})).map((function(e){return t.data[e]}),this)}}])&&Cu(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}(),Nu={SLL:0,LL:1,LL_EXACT_AMBIG_DETECTION:2,hasSLLConflictTerminatingPrediction:function(t,e){if(Nu.allConfigsInRuleStopStates(e))return!0;if(t===Nu.SLL&&e.hasSemanticContext){for(var n=new Ki,r=0;r<e.items.length;r++){var o=e.items[r];o=new L({semanticContext:j.NONE},o),n.add(o)}e=n}var i=Nu.getConflictingAltSubsets(e);return Nu.hasConflictingAltSet(i)&&!Nu.hasStateAssociatedWithOneAlt(e)},hasConfigInRuleStopState:function(t){for(var e=0;e<t.items.length;e++)if(t.items[e].state instanceof $)return!0;return!1},allConfigsInRuleStopStates:function(t){for(var e=0;e<t.items.length;e++)if(!(t.items[e].state instanceof $))return!1;return!0},resolvesToJustOneViableAlt:function(t){return Nu.getSingleViableAlt(t)},allSubsetsConflict:function(t){return!Nu.hasNonConflictingAltSet(t)},hasNonConflictingAltSet:function(t){for(var e=0;e<t.length;e++)if(1===t[e].length)return!0;return!1},hasConflictingAltSet:function(t){for(var e=0;e<t.length;e++)if(t[e].length>1)return!0;return!1},allSubsetsEqual:function(t){for(var e=null,n=0;n<t.length;n++){var r=t[n];if(null===e)e=r;else if(r!==e)return!1}return!0},getUniqueAlt:function(t){var e=Nu.getAlts(t);return 1===e.length?e.minValue():Fe.INVALID_ALT_NUMBER},getAlts:function(t){var e=new Ce;return t.map((function(t){e.or(t)})),e},getConflictingAltSubsets:function(t){var e=new Te;return e.hashFunction=function(t){f.hashStuff(t.state.stateNumber,t.context)},e.equalsFunction=function(t,e){return t.state.stateNumber===e.state.stateNumber&&t.context.equals(e.context)},t.items.map((function(t){var n=e.get(t);null===n&&(n=new Ce,e.set(t,n)),n.add(t.alt)})),e.getValues()},getStateToAltMap:function(t){var e=new Au;return t.items.map((function(t){var n=e.get(t.state);null===n&&(n=new Ce,e.set(t.state,n)),n.add(t.alt)})),e},hasStateAssociatedWithOneAlt:function(t){for(var e=Nu.getStateToAltMap(t).values(),n=0;n<e.length;n++)if(1===e[n].length)return!0;return!1},getSingleViableAlt:function(t){for(var e=null,n=0;n<t.length;n++){var r=t[n].minValue();if(null===e)e=r;else if(e!==r)return Fe.INVALID_ALT_NUMBER}return e}};const Iu=Nu;function Lu(t){return Lu="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Lu(t)}function Du(t,e){return Du=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Du(t,e)}function Fu(t){return Fu=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Fu(t)}var Bu=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Du(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Fu(n);if(r){var o=Fu(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Lu(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(t,e,n,r,u,c){var a;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),c=c||t._ctx,r=r||t.getCurrentToken(),n=n||t.getCurrentToken(),e=e||t.getInputStream(),(a=o.call(this,{message:"",recognizer:t,input:e,ctx:c})).deadEndConfigs=u,a.startToken=n,a.offendingToken=r,a}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(xi);function Mu(t){return Mu="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Mu(t)}function Uu(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Mu(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Mu(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Mu(o)?o:String(o)),r)}var o}var Vu=function(){function t(e){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.defaultMapCtor=e||Te,this.cacheMap=new this.defaultMapCtor}var e,n;return e=t,(n=[{key:"get",value:function(t,e){var n=this.cacheMap.get(t)||null;return null===n?null:n.get(e)||null}},{key:"set",value:function(t,e,n){var r=this.cacheMap.get(t)||null;null===r&&(r=new this.defaultMapCtor,this.cacheMap.set(t,r)),r.set(e,n)}}])&&Uu(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function zu(t){return zu="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},zu(t)}function qu(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==zu(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==zu(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===zu(o)?o:String(o)),r)}var o}function Hu(t,e){return Hu=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Hu(t,e)}function Ku(t){return Ku=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Ku(t)}var Yu=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Hu(t,e)}(c,t);var e,n,r,i,u=(r=c,i=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Ku(r);if(i){var n=Ku(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===zu(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function c(t,e,n,r){var o;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,c),(o=u.call(this,e,r)).parser=t,o.decisionToDFA=n,o.predictionMode=Iu.LL,o._input=null,o._startIndex=0,o._outerContext=null,o._dfa=null,o.mergeCache=null,o.debug=!1,o.debug_closure=!1,o.debug_add=!1,o.trace_atn_sim=!1,o.dfa_debug=!1,o.retry_debug=!1,o}return e=c,n=[{key:"reset",value:function(){}},{key:"adaptivePredict",value:function(t,e,n){(this.debug||this.trace_atn_sim)&&console.log("adaptivePredict decision "+e+" exec LA(1)=="+this.getLookaheadName(t)+" line "+t.LT(1).line+":"+t.LT(1).column),this._input=t,this._startIndex=t.index,this._outerContext=n;var r=this.decisionToDFA[e];this._dfa=r;var o=t.mark(),i=t.index;try{var u;if(null===(u=r.precedenceDfa?r.getPrecedenceStartState(this.parser.getPrecedence()):r.s0)){null===n&&(n=ee.EMPTY),this.debug&&console.log("predictATN decision "+r.decision+" exec LA(1)=="+this.getLookaheadName(t)+", outerContext="+n.toString(this.parser.ruleNames));var c=this.computeStartState(r.atnStartState,ee.EMPTY,!1);r.precedenceDfa?(r.s0.configs=c,c=this.applyPrecedenceFilter(c),u=this.addDFAState(r,new Wi(null,c)),r.setPrecedenceStartState(this.parser.getPrecedence(),u)):(u=this.addDFAState(r,new Wi(null,c)),r.s0=u)}var a=this.execATN(r,u,t,i,n);return this.debug&&console.log("DFA after predictATN: "+r.toString(this.parser.literalNames,this.parser.symbolicNames)),a}finally{this._dfa=null,this.mergeCache=null,t.seek(i),t.release(o)}}},{key:"execATN",value:function(t,e,n,r,i){var u;(this.debug||this.trace_atn_sim)&&console.log("execATN decision "+t.decision+", DFA state "+e+", LA(1)=="+this.getLookaheadName(n)+" line "+n.LT(1).line+":"+n.LT(1).column);var c=e;this.debug&&console.log("s0 = "+e);for(var a=n.LA(1);;){var l=this.getExistingTargetState(c,a);if(null===l&&(l=this.computeTargetState(t,c,a)),l===Ji.ERROR){var s=this.noViableAlt(n,i,c.configs,r);if(n.seek(r),(u=this.getSynValidOrSemInvalidAltThatFinishedDecisionEntryRule(c.configs,i))!==Fe.INVALID_ALT_NUMBER)return u;throw s}if(l.requiresFullContext&&this.predictionMode!==Iu.SLL){var f=null;if(null!==l.predicates){this.debug&&console.log("DFA state has preds in DFA sim LL failover");var p=n.index;if(p!==r&&n.seek(r),1===(f=this.evalSemanticContext(l.predicates,i,!0)).length)return this.debug&&console.log("Full LL avoided"),f.minValue();p!==r&&n.seek(p)}this.dfa_debug&&console.log("ctx sensitive state "+i+" in "+l);var y=this.computeStartState(t.atnStartState,i,!0);return this.reportAttemptingFullContext(t,f,l.configs,r,n.index),this.execATNWithFullContext(t,l,y,n,r,i)}if(l.isAcceptState){if(null===l.predicates)return l.prediction;var h=n.index;n.seek(r);var b=this.evalSemanticContext(l.predicates,i,!0);if(0===b.length)throw this.noViableAlt(n,i,l.configs,r);return 1===b.length||this.reportAmbiguity(t,l,r,h,!1,b,l.configs),b.minValue()}c=l,a!==o.EOF&&(n.consume(),a=n.LA(1))}}},{key:"getExistingTargetState",value:function(t,e){var n=t.edges;return null===n?null:n[e+1]||null}},{key:"computeTargetState",value:function(t,e,n){var r=this.computeReachSet(e.configs,n,!1);if(null===r)return this.addDFAEdge(t,e,n,Ji.ERROR),Ji.ERROR;var o=new Wi(null,r),i=this.getUniqueAlt(r);if(this.debug){var u=Iu.getConflictingAltSubsets(r);console.log("SLL altSubSets="+b(u)+", configs="+r+", predict="+i+", allSubsetsConflict="+Iu.allSubsetsConflict(u)+", conflictingAlts="+this.getConflictingAlts(r))}return i!==Fe.INVALID_ALT_NUMBER?(o.isAcceptState=!0,o.configs.uniqueAlt=i,o.prediction=i):Iu.hasSLLConflictTerminatingPrediction(this.predictionMode,r)&&(o.configs.conflictingAlts=this.getConflictingAlts(r),o.requiresFullContext=!0,o.isAcceptState=!0,o.prediction=o.configs.conflictingAlts.minValue()),o.isAcceptState&&o.configs.hasSemanticContext&&(this.predicateDFAState(o,this.atn.getDecisionState(t.decision)),null!==o.predicates&&(o.prediction=Fe.INVALID_ALT_NUMBER)),this.addDFAEdge(t,e,n,o)}},{key:"predicateDFAState",value:function(t,e){var n=e.transitions.length,r=this.getConflictingAltsOrUniqueAlt(t.configs),o=this.getPredsForAmbigAlts(r,t.configs,n);null!==o?(t.predicates=this.getPredicatePredictions(r,o),t.prediction=Fe.INVALID_ALT_NUMBER):t.prediction=r.minValue()}},{key:"execATNWithFullContext",value:function(t,e,n,r,i,u){(this.debug||this.trace_atn_sim)&&console.log("execATNWithFullContext "+n);var c,a=!1,l=n;r.seek(i);for(var s=r.LA(1),f=-1;;){if(null===(c=this.computeReachSet(l,s,!0))){var p=this.noViableAlt(r,u,l,i);r.seek(i);var y=this.getSynValidOrSemInvalidAltThatFinishedDecisionEntryRule(l,u);if(y!==Fe.INVALID_ALT_NUMBER)return y;throw p}var h=Iu.getConflictingAltSubsets(c);if(this.debug&&console.log("LL altSubSets="+h+", predict="+Iu.getUniqueAlt(h)+", resolvesToJustOneViableAlt="+Iu.resolvesToJustOneViableAlt(h)),c.uniqueAlt=this.getUniqueAlt(c),c.uniqueAlt!==Fe.INVALID_ALT_NUMBER){f=c.uniqueAlt;break}if(this.predictionMode!==Iu.LL_EXACT_AMBIG_DETECTION){if((f=Iu.resolvesToJustOneViableAlt(h))!==Fe.INVALID_ALT_NUMBER)break}else if(Iu.allSubsetsConflict(h)&&Iu.allSubsetsEqual(h)){a=!0,f=Iu.getSingleViableAlt(h);break}l=c,s!==o.EOF&&(r.consume(),s=r.LA(1))}return c.uniqueAlt!==Fe.INVALID_ALT_NUMBER?(this.reportContextSensitivity(t,f,c,i,r.index),f):(this.reportAmbiguity(t,e,i,r.index,a,null,c),f)}},{key:"computeReachSet",value:function(t,e,n){this.debug&&console.log("in computeReachSet, starting closure: "+t),null===this.mergeCache&&(this.mergeCache=new Vu);for(var r=new Ki(n),i=null,u=0;u<t.items.length;u++){var c=t.items[u];if(this.debug&&console.log("testing "+this.getTokenName(e)+" at "+c),c.state instanceof $)(n||e===o.EOF)&&(null===i&&(i=[]),i.push(c),this.debug_add&&console.log("added "+c+" to skippedStopStates"));else for(var a=0;a<c.state.transitions.length;a++){var l=c.state.transitions[a],s=this.getReachableTarget(l,e);if(null!==s){var f=new L({state:s},c);r.add(f,this.mergeCache),this.debug_add&&console.log("added "+f+" to intermediate")}}}var p=null;if(null===i&&e!==o.EOF&&(1===r.items.length||this.getUniqueAlt(r)!==Fe.INVALID_ALT_NUMBER)&&(p=r),null===p){p=new Ki(n);for(var y=new g,h=e===o.EOF,b=0;b<r.items.length;b++)this.closure(r.items[b],p,y,!1,n,h)}if(e===o.EOF&&(p=this.removeAllConfigsNotInRuleStopState(p,p===r)),!(null===i||n&&Iu.hasConfigInRuleStopState(p)))for(var v=0;v<i.length;v++)p.add(i[v],this.mergeCache);return this.trace_atn_sim&&console.log("computeReachSet "+t+" -> "+p),0===p.items.length?null:p}},{key:"removeAllConfigsNotInRuleStopState",value:function(t,e){if(Iu.allConfigsInRuleStopStates(t))return t;for(var n=new Ki(t.fullCtx),r=0;r<t.items.length;r++){var i=t.items[r];if(i.state instanceof $)n.add(i,this.mergeCache);else if(e&&i.state.epsilonOnlyTransitions&&this.atn.nextTokens(i.state).contains(o.EPSILON)){var u=this.atn.ruleToStopState[i.state.ruleIndex];n.add(new L({state:u},i),this.mergeCache)}}return n}},{key:"computeStartState",value:function(t,e,n){var r=Ee(this.atn,e),o=new Ki(n);this.trace_atn_sim&&console.log("computeStartState from ATN state "+t+" initialContext="+r.toString(this.parser));for(var i=0;i<t.transitions.length;i++){var u=t.transitions[i].target,c=new L({state:u,alt:i+1,context:r},null),a=new g;this.closure(c,o,a,!0,n,!1)}return o}},{key:"applyPrecedenceFilter",value:function(t){for(var e,n=[],r=new Ki(t.fullCtx),o=0;o<t.items.length;o++)if(1===(e=t.items[o]).alt){var i=e.semanticContext.evalPrecedence(this.parser,this._outerContext);null!==i&&(n[e.state.stateNumber]=e.context,i!==e.semanticContext?r.add(new L({semanticContext:i},e),this.mergeCache):r.add(e,this.mergeCache))}for(var u=0;u<t.items.length;u++)if(1!==(e=t.items[u]).alt){if(!e.precedenceFilterSuppressed){var c=n[e.state.stateNumber]||null;if(null!==c&&c.equals(e.context))continue}r.add(e,this.mergeCache)}return r}},{key:"getReachableTarget",value:function(t,e){return t.matches(e,0,this.atn.maxTokenType)?t.target:null}},{key:"getPredsForAmbigAlts",value:function(t,e,n){for(var r=[],o=0;o<e.items.length;o++){var i=e.items[o];t.has(i.alt)&&(r[i.alt]=j.orContext(r[i.alt]||null,i.semanticContext))}for(var u=0,c=1;c<n+1;c++){var a=r[c]||null;null===a?r[c]=j.NONE:a!==j.NONE&&(u+=1)}return 0===u&&(r=null),this.debug&&console.log("getPredsForAmbigAlts result "+b(r)),r}},{key:"getPredicatePredictions",value:function(t,e){for(var n=[],r=!1,o=1;o<e.length;o++){var i=e[o];null!==t&&t.has(o)&&n.push(new xu(i,o)),i!==j.NONE&&(r=!0)}return r?n:null}},{key:"getSynValidOrSemInvalidAltThatFinishedDecisionEntryRule",value:function(t,e){var n=this.splitAccordingToSemanticValidity(t,e),r=n[0],o=n[1],i=this.getAltThatFinishedDecisionEntryRule(r);return i!==Fe.INVALID_ALT_NUMBER||o.items.length>0&&(i=this.getAltThatFinishedDecisionEntryRule(o))!==Fe.INVALID_ALT_NUMBER?i:Fe.INVALID_ALT_NUMBER}},{key:"getAltThatFinishedDecisionEntryRule",value:function(t){for(var e=[],n=0;n<t.items.length;n++){var r=t.items[n];(r.reachesIntoOuterContext>0||r.state instanceof $&&r.context.hasEmptyPath())&&e.indexOf(r.alt)<0&&e.push(r.alt)}return 0===e.length?Fe.INVALID_ALT_NUMBER:Math.min.apply(null,e)}},{key:"splitAccordingToSemanticValidity",value:function(t,e){for(var n=new Ki(t.fullCtx),r=new Ki(t.fullCtx),o=0;o<t.items.length;o++){var i=t.items[o];i.semanticContext!==j.NONE?i.semanticContext.evaluate(this.parser,e)?n.add(i):r.add(i):n.add(i)}return[n,r]}},{key:"evalSemanticContext",value:function(t,e,n){for(var r=new Ce,o=0;o<t.length;o++){var i=t[o];if(i.pred!==j.NONE){var u=i.pred.evaluate(this.parser,e);if((this.debug||this.dfa_debug)&&console.log("eval pred "+i+"="+u),u&&((this.debug||this.dfa_debug)&&console.log("PREDICT "+i.alt),r.add(i.alt),!n))break}else if(r.add(i.alt),!n)break}return r}},{key:"closure",value:function(t,e,n,r,o,i){this.closureCheckingStopState(t,e,n,r,o,0,i)}},{key:"closureCheckingStopState",value:function(t,e,n,r,o,i,u){if((this.trace_atn_sim||this.debug_closure)&&console.log("closure("+t.toString(this.parser,!0)+")"),t.state instanceof $){if(!t.context.isEmpty()){for(var c=0;c<t.context.length;c++)if(t.context.getReturnState(c)!==oe.EMPTY_RETURN_STATE){var a=this.atn.states[t.context.getReturnState(c)],l=t.context.getParent(c),s={state:a,alt:t.alt,context:l,semanticContext:t.semanticContext},f=new L(s,null);f.reachesIntoOuterContext=t.reachesIntoOuterContext,this.closureCheckingStopState(f,e,n,r,o,i-1,u)}else{if(o){e.add(new L({state:t.state,context:oe.EMPTY},t),this.mergeCache);continue}this.debug&&console.log("FALLING off rule "+this.getRuleName(t.state.ruleIndex)),this.closure_(t,e,n,r,o,i,u)}return}if(o)return void e.add(t,this.mergeCache);this.debug&&console.log("FALLING off rule "+this.getRuleName(t.state.ruleIndex))}this.closure_(t,e,n,r,o,i,u)}},{key:"closure_",value:function(t,e,n,r,o,i,u){var c=t.state;c.epsilonOnlyTransitions||e.add(t,this.mergeCache);for(var a=0;a<c.transitions.length;a++)if(0!==a||!this.canDropLoopEntryEdgeInLeftRecursiveRule(t)){var l=c.transitions[a],s=r&&!(l instanceof Or),f=this.getEpsilonTarget(t,l,s,0===i,o,u);if(null!==f){var p=i;if(t.state instanceof $){if(null!==this._dfa&&this._dfa.precedenceDfa&&l.outermostPrecedenceReturn===this._dfa.atnStartState.ruleIndex&&(f.precedenceFilterSuppressed=!0),f.reachesIntoOuterContext+=1,n.add(f)!==f)continue;e.dipsIntoOuterContext=!0,p-=1,this.debug&&console.log("dips into outer ctx: "+f)}else{if(!l.isEpsilon&&n.add(f)!==f)continue;l instanceof it&&p>=0&&(p+=1)}this.closureCheckingStopState(f,e,n,s,o,p,u)}}}},{key:"canDropLoopEntryEdgeInLeftRecursiveRule",value:function(t){var e=t.state;if(e.stateType!==H.STAR_LOOP_ENTRY)return!1;if(e.stateType!==H.STAR_LOOP_ENTRY||!e.isPrecedenceDecision||t.context.isEmpty()||t.context.hasEmptyPath())return!1;for(var n=t.context.length,r=0;r<n;r++)if(this.atn.states[t.context.getReturnState(r)].ruleIndex!==e.ruleIndex)return!1;for(var o=e.transitions[0].target.endState.stateNumber,i=this.atn.states[o],u=0;u<n;u++){var c=t.context.getReturnState(u),a=this.atn.states[c];if(1!==a.transitions.length||!a.transitions[0].isEpsilon)return!1;var l=a.transitions[0].target;if(!(a.stateType===H.BLOCK_END&&l===e||a===i||l===i||l.stateType===H.BLOCK_END&&1===l.transitions.length&&l.transitions[0].isEpsilon&&l.transitions[0].target===e))return!1}return!0}},{key:"getRuleName",value:function(t){return null!==this.parser&&t>=0?this.parser.ruleNames[t]:"<rule "+t+">"}},{key:"getEpsilonTarget",value:function(t,e,n,r,i,u){switch(e.serializationType){case tt.RULE:return this.ruleTransition(t,e);case tt.PRECEDENCE:return this.precedenceTransition(t,e,n,r,i);case tt.PREDICATE:return this.predTransition(t,e,n,r,i);case tt.ACTION:return this.actionTransition(t,e);case tt.EPSILON:return new L({state:e.target},t);case tt.ATOM:case tt.RANGE:case tt.SET:return u&&e.matches(o.EOF,0,1)?new L({state:e.target},t):null;default:return null}}},{key:"actionTransition",value:function(t,e){if(this.debug){var n=-1===e.actionIndex?65535:e.actionIndex;console.log("ACTION edge "+e.ruleIndex+":"+n)}return new L({state:e.target},t)}},{key:"precedenceTransition",value:function(t,e,n,r,o){this.debug&&(console.log("PRED (collectPredicates="+n+") "+e.precedence+">=_p, ctx dependent=true"),null!==this.parser&&console.log("context surrounding pred is "+b(this.parser.getRuleInvocationStack())));var i=null;if(n&&r)if(o){var u=this._input.index;this._input.seek(this._startIndex);var c=e.getPredicate().evaluate(this.parser,this._outerContext);this._input.seek(u),c&&(i=new L({state:e.target},t))}else{var a=j.andContext(t.semanticContext,e.getPredicate());i=new L({state:e.target,semanticContext:a},t)}else i=new L({state:e.target},t);return this.debug&&console.log("config from pred transition="+i),i}},{key:"predTransition",value:function(t,e,n,r,o){this.debug&&(console.log("PRED (collectPredicates="+n+") "+e.ruleIndex+":"+e.predIndex+", ctx dependent="+e.isCtxDependent),null!==this.parser&&console.log("context surrounding pred is "+b(this.parser.getRuleInvocationStack())));var i=null;if(n&&(e.isCtxDependent&&r||!e.isCtxDependent))if(o){var u=this._input.index;this._input.seek(this._startIndex);var c=e.getPredicate().evaluate(this.parser,this._outerContext);this._input.seek(u),c&&(i=new L({state:e.target},t))}else{var a=j.andContext(t.semanticContext,e.getPredicate());i=new L({state:e.target,semanticContext:a},t)}else i=new L({state:e.target},t);return this.debug&&console.log("config from pred transition="+i),i}},{key:"ruleTransition",value:function(t,e){this.debug&&console.log("CALL rule "+this.getRuleName(e.target.ruleIndex)+", ctx="+t.context);var n=e.followState,r=ve.create(t.context,n.stateNumber);return new L({state:e.target,context:r},t)}},{key:"getConflictingAlts",value:function(t){var e=Iu.getConflictingAltSubsets(t);return Iu.getAlts(e)}},{key:"getConflictingAltsOrUniqueAlt",value:function(t){var e=null;return t.uniqueAlt!==Fe.INVALID_ALT_NUMBER?(e=new Ce).add(t.uniqueAlt):e=t.conflictingAlts,e}},{key:"getTokenName",value:function(t){if(t===o.EOF)return"EOF";if(null!==this.parser&&null!==this.parser.literalNames){if(!(t>=this.parser.literalNames.length&&t>=this.parser.symbolicNames.length))return(this.parser.literalNames[t]||this.parser.symbolicNames[t])+"<"+t+">";console.log(t+" ttype out of range: "+this.parser.literalNames),console.log(""+this.parser.getInputStream().getTokens())}return""+t}},{key:"getLookaheadName",value:function(t){return this.getTokenName(t.LA(1))}},{key:"dumpDeadEndConfigs",value:function(t){console.log("dead end configs: ");for(var e=t.getDeadEndConfigs(),n=0;n<e.length;n++){var r=e[n],o="no edges";if(r.state.transitions.length>0){var i=r.state.transitions[0];i instanceof fr?o="Atom "+this.getTokenName(i.label):i instanceof st&&(o=(i instanceof vt?"~":"")+"Set "+i.set)}console.error(r.toString(this.parser,!0)+":"+o)}}},{key:"noViableAlt",value:function(t,e,n,r){return new Bu(this.parser,t,t.get(r),t.LT(1),n,e)}},{key:"getUniqueAlt",value:function(t){for(var e=Fe.INVALID_ALT_NUMBER,n=0;n<t.items.length;n++){var r=t.items[n];if(e===Fe.INVALID_ALT_NUMBER)e=r.alt;else if(r.alt!==e)return Fe.INVALID_ALT_NUMBER}return e}},{key:"addDFAEdge",value:function(t,e,n,r){if(this.debug&&console.log("EDGE "+e+" -> "+r+" upon "+this.getTokenName(n)),null===r)return null;if(r=this.addDFAState(t,r),null===e||n<-1||n>this.atn.maxTokenType)return r;if(null===e.edges&&(e.edges=[]),e.edges[n+1]=r,this.debug){var o=null===this.parser?null:this.parser.literalNames,i=null===this.parser?null:this.parser.symbolicNames;console.log("DFA=\n"+t.toString(o,i))}return r}},{key:"addDFAState",value:function(t,e){if(e===Ji.ERROR)return e;var n=t.states.get(e);return null!==n?(this.trace_atn_sim&&console.log("addDFAState "+e+" exists"),n):(e.stateNumber=t.states.length,e.configs.readOnly||(e.configs.optimizeConfigs(this),e.configs.setReadonly(!0)),this.trace_atn_sim&&console.log("addDFAState new "+e),t.states.add(e),this.debug&&console.log("adding new DFA state: "+e),e)}},{key:"reportAttemptingFullContext",value:function(t,e,n,r,o){if(this.debug||this.retry_debug){var i=new B(r,o+1);console.log("reportAttemptingFullContext decision="+t.decision+":"+n+", input="+this.parser.getTokenStream().getText(i))}null!==this.parser&&this.parser.getErrorListenerDispatch().reportAttemptingFullContext(this.parser,t,r,o,e,n)}},{key:"reportContextSensitivity",value:function(t,e,n,r,o){if(this.debug||this.retry_debug){var i=new B(r,o+1);console.log("reportContextSensitivity decision="+t.decision+":"+n+", input="+this.parser.getTokenStream().getText(i))}null!==this.parser&&this.parser.getErrorListenerDispatch().reportContextSensitivity(this.parser,t,r,o,e,n)}},{key:"reportAmbiguity",value:function(t,e,n,r,o,i,u){if(this.debug||this.retry_debug){var c=new B(n,r+1);console.log("reportAmbiguity "+i+":"+u+", input="+this.parser.getTokenStream().getText(c))}null!==this.parser&&this.parser.getErrorListenerDispatch().reportAmbiguity(this.parser,t,n,r,o,i,u)}}],n&&qu(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),c}(Ji);function Gu(t){return Gu="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Gu(t)}function Wu(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Gu(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Gu(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Gu(o)?o:String(o)),r)}var o}var Xu=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.cache=new Te}var e,n;return e=t,(n=[{key:"add",value:function(t){if(t===oe.EMPTY)return oe.EMPTY;var e=this.cache.get(t)||null;return null!==e?e:(this.cache.set(t,t),t)}},{key:"get",value:function(t){return this.cache.get(t)||null}},{key:"length",get:function(){return this.cache.length}}])&&Wu(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();const $u={ATN:Fe,ATNDeserializer:Ho,LexerATNSimulator:Eu,ParserATNSimulator:Yu,PredictionMode:Iu,PredictionContextCache:Xu};function Ju(t){return Ju="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ju(t)}function Qu(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Ju(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Ju(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Ju(o)?o:String(o)),r)}var o}var Zu=function(){function t(e,n,r){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.dfa=e,this.literalNames=n||[],this.symbolicNames=r||[]}var e,n;return e=t,n=[{key:"toString",value:function(){if(null===this.dfa.s0)return null;for(var t="",e=this.dfa.sortedStates(),n=0;n<e.length;n++){var r=e[n];if(null!==r.edges)for(var o=r.edges.length,i=0;i<o;i++){var u=r.edges[i]||null;null!==u&&2147483647!==u.stateNumber&&(t=(t=(t=(t=(t=(t=t.concat(this.getStateString(r))).concat("-")).concat(this.getEdgeLabel(i))).concat("->")).concat(this.getStateString(u))).concat("\n"))}}return 0===t.length?null:t}},{key:"getEdgeLabel",value:function(t){return 0===t?"EOF":null!==this.literalNames||null!==this.symbolicNames?this.literalNames[t-1]||this.symbolicNames[t-1]:String.fromCharCode(t-1)}},{key:"getStateString",value:function(t){var e=(t.isAcceptState?":":"")+"s"+t.stateNumber+(t.requiresFullContext?"^":"");return t.isAcceptState?null!==t.predicates?e+"=>"+b(t.predicates):e+"=>"+t.prediction.toString():e}}],n&&Qu(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function tc(t){return tc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},tc(t)}function ec(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==tc(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==tc(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===tc(o)?o:String(o)),r)}var o}function nc(t,e){return nc=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},nc(t,e)}function rc(t){return rc=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},rc(t)}var oc=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&nc(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=rc(r);if(o){var n=rc(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===tc(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),i.call(this,t,null)}return e=u,n=[{key:"getEdgeLabel",value:function(t){return"'"+String.fromCharCode(t)+"'"}}],n&&ec(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Zu);function ic(t){return ic="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ic(t)}function uc(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==ic(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==ic(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===ic(o)?o:String(o)),r)}var o}var cc=function(){function t(e,n){if(function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),void 0===n&&(n=0),this.atnStartState=e,this.decision=n,this._states=new g,this.s0=null,this.precedenceDfa=!1,e instanceof zn&&e.isPrecedenceDecision){this.precedenceDfa=!0;var r=new Wi(null,new Ki);r.edges=[],r.isAcceptState=!1,r.requiresFullContext=!1,this.s0=r}}var e,n;return e=t,(n=[{key:"getPrecedenceStartState",value:function(t){if(!this.precedenceDfa)throw"Only precedence DFAs may contain a precedence start state.";return t<0||t>=this.s0.edges.length?null:this.s0.edges[t]||null}},{key:"setPrecedenceStartState",value:function(t,e){if(!this.precedenceDfa)throw"Only precedence DFAs may contain a precedence start state.";t<0||(this.s0.edges[t]=e)}},{key:"setPrecedenceDfa",value:function(t){if(this.precedenceDfa!==t){if(this._states=new g,t){var e=new Wi(null,new Ki);e.edges=[],e.isAcceptState=!1,e.requiresFullContext=!1,this.s0=e}else this.s0=null;this.precedenceDfa=t}}},{key:"sortedStates",value:function(){return this._states.values().sort((function(t,e){return t.stateNumber-e.stateNumber}))}},{key:"toString",value:function(t,e){return t=t||null,e=e||null,null===this.s0?"":new Zu(this,t,e).toString()}},{key:"toLexerString",value:function(){return null===this.s0?"":new oc(this).toString()}},{key:"states",get:function(){return this._states}}])&&uc(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();const ac={DFA:cc,DFASerializer:Zu,LexerDFASerializer:oc,PredPrediction:xu},lc={PredictionContext:oe},sc={Interval:B,IntervalSet:V};function fc(t){return fc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},fc(t)}function pc(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==fc(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==fc(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===fc(o)?o:String(o)),r)}var o}var yc=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t)}var e,n;return e=t,(n=[{key:"visitTerminal",value:function(t){}},{key:"visitErrorNode",value:function(t){}},{key:"enterEveryRule",value:function(t){}},{key:"exitEveryRule",value:function(t){}}])&&pc(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function hc(t){return hc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},hc(t)}function bc(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==hc(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==hc(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===hc(o)?o:String(o)),r)}var o}var vc=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t)}var e,n;return e=t,(n=[{key:"visit",value:function(t){return Array.isArray(t)?t.map((function(t){return t.accept(this)}),this):t.accept(this)}},{key:"visitChildren",value:function(t){return t.children?this.visit(t.children):null}},{key:"visitTerminal",value:function(t){}},{key:"visitErrorNode",value:function(t){}}])&&bc(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function dc(t){return dc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},dc(t)}function mc(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==dc(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==dc(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===dc(o)?o:String(o)),r)}var o}var gc=function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t)}var e,n;return e=t,n=[{key:"walk",value:function(t,e){if(e instanceof Wt||void 0!==e.isErrorNode&&e.isErrorNode())t.visitErrorNode(e);else if(e instanceof Ht)t.visitTerminal(e);else{this.enterRule(t,e);for(var n=0;n<e.getChildCount();n++){var r=e.getChild(n);this.walk(t,r)}this.exitRule(t,e)}}},{key:"enterRule",value:function(t,e){var n=e.ruleContext;t.enterEveryRule(n),n.enterRule(t)}},{key:"exitRule",value:function(t,e){var n=e.ruleContext;n.exitRule(t),t.exitEveryRule(n)}}],n&&mc(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();gc.DEFAULT=new gc;const Sc={Trees:$t,RuleNode:Ut,ErrorNode:Wt,TerminalNode:Ht,ParseTreeListener:yc,ParseTreeVisitor:vc,ParseTreeWalker:gc};function Oc(t){return Oc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Oc(t)}function wc(t,e){return wc=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},wc(t,e)}function _c(t){return _c=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},_c(t)}var Pc=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&wc(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=_c(n);if(r){var o=_c(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Oc(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),(e=o.call(this,{message:"",recognizer:t,input:t.getInputStream(),ctx:t._ctx})).offendingToken=t.getCurrentToken(),e}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(xi);function Tc(t){return Tc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Tc(t)}function Ec(t,e){return Ec=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Ec(t,e)}function kc(t){return kc=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},kc(t)}var jc=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Ec(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=kc(n);if(r){var o=kc(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Tc(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(t,e,n){var r;!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),r=o.call(this,{message:xc(e,n||null),recognizer:t,input:t.getInputStream(),ctx:t._ctx});var u=t._interp.atn.states[t.state].transitions[0];return u instanceof Dr?(r.ruleIndex=u.ruleIndex,r.predicateIndex=u.predIndex):(r.ruleIndex=0,r.predicateIndex=0),r.predicate=e,r.offendingToken=t.getCurrentToken(),r}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(xi);function xc(t,e){return null!==e?e:"failed predicate: {"+t+"}?"}function Rc(t){return Rc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Rc(t)}function Cc(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Rc(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Rc(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Rc(o)?o:String(o)),r)}var o}function Ac(t,e){return Ac=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Ac(t,e)}function Nc(t){return Nc=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Nc(t)}var Ic=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Ac(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Nc(r);if(o){var n=Nc(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Rc(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),t=t||!0,(e=i.call(this)).exactOnly=t,e}return e=u,n=[{key:"reportAmbiguity",value:function(t,e,n,r,o,i,u){if(!this.exactOnly||o){var c="reportAmbiguity d="+this.getDecisionDescription(t,e)+": ambigAlts="+this.getConflictingAlts(i,u)+", input='"+t.getTokenStream().getText(new B(n,r))+"'";t.notifyErrorListeners(c)}}},{key:"reportAttemptingFullContext",value:function(t,e,n,r,o,i){var u="reportAttemptingFullContext d="+this.getDecisionDescription(t,e)+", input='"+t.getTokenStream().getText(new B(n,r))+"'";t.notifyErrorListeners(u)}},{key:"reportContextSensitivity",value:function(t,e,n,r,o,i){var u="reportContextSensitivity d="+this.getDecisionDescription(t,e)+", input='"+t.getTokenStream().getText(new B(n,r))+"'";t.notifyErrorListeners(u)}},{key:"getDecisionDescription",value:function(t,e){var n=e.decision,r=e.atnStartState.ruleIndex,o=t.ruleNames;if(r<0||r>=o.length)return""+n;var i=o[r]||null;return null===i||0===i.length?""+n:"".concat(n," (").concat(i,")")}},{key:"getConflictingAlts",value:function(t,e){if(null!==t)return t;for(var n=new Ce,r=0;r<e.items.length;r++)n.add(e.items[r].alt);return"{".concat(n.values().join(", "),"}")}}],n&&Cc(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Go);function Lc(t){return Lc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Lc(t)}function Dc(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function Fc(t){var e="function"==typeof Map?new Map:void 0;return Fc=function(t){if(null===t||(n=t,-1===Function.toString.call(n).indexOf("[native code]")))return t;var n;if("function"!=typeof t)throw new TypeError("Super expression must either be null or a function");if(void 0!==e){if(e.has(t))return e.get(t);e.set(t,r)}function r(){return Bc(t,arguments,Vc(this).constructor)}return r.prototype=Object.create(t.prototype,{constructor:{value:r,enumerable:!1,writable:!0,configurable:!0}}),Uc(r,t)},Fc(t)}function Bc(t,e,n){return Bc=Mc()?Reflect.construct.bind():function(t,e,n){var r=[null];r.push.apply(r,e);var o=new(Function.bind.apply(t,r));return n&&Uc(o,n.prototype),o},Bc.apply(null,arguments)}function Mc(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}function Uc(t,e){return Uc=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Uc(t,e)}function Vc(t){return Vc=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Vc(t)}var zc=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Uc(t,e)}(i,t);var e,n,r,o=(n=i,r=Mc(),function(){var t,e=Vc(n);if(r){var o=Vc(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Lc(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return Dc(t)}(this,t)});function i(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),t=o.call(this),Error.captureStackTrace(Dc(t),i),t}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(Fc(Error));function qc(t){return qc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},qc(t)}function Hc(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==qc(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==qc(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===qc(o)?o:String(o)),r)}var o}function Kc(t){return Kc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Kc(t)}function Yc(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Kc(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Kc(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Kc(o)?o:String(o)),r)}var o}function Gc(t,e){return Gc=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Gc(t,e)}function Wc(t){return Wc=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Wc(t)}var Xc=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Gc(t,e)}(c,t);var e,n,r,i,u=(r=c,i=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Wc(r);if(i){var n=Wc(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Kc(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function c(){var t;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,c),(t=u.call(this)).errorRecoveryMode=!1,t.lastErrorIndex=-1,t.lastErrorStates=null,t.nextTokensContext=null,t.nextTokenState=0,t}return e=c,n=[{key:"reset",value:function(t){this.endErrorCondition(t)}},{key:"beginErrorCondition",value:function(t){this.errorRecoveryMode=!0}},{key:"inErrorRecoveryMode",value:function(t){return this.errorRecoveryMode}},{key:"endErrorCondition",value:function(t){this.errorRecoveryMode=!1,this.lastErrorStates=null,this.lastErrorIndex=-1}},{key:"reportMatch",value:function(t){this.endErrorCondition(t)}},{key:"reportError",value:function(t,e){this.inErrorRecoveryMode(t)||(this.beginErrorCondition(t),e instanceof Bu?this.reportNoViableAlternative(t,e):e instanceof Pc?this.reportInputMismatch(t,e):e instanceof jc?this.reportFailedPredicate(t,e):(console.log("unknown recognition error type: "+e.constructor.name),console.log(e.stack),t.notifyErrorListeners(e.getOffendingToken(),e.getMessage(),e)))}},{key:"recover",value:function(t,e){this.lastErrorIndex===t.getInputStream().index&&null!==this.lastErrorStates&&this.lastErrorStates.indexOf(t.state)>=0&&t.consume(),this.lastErrorIndex=t._input.index,null===this.lastErrorStates&&(this.lastErrorStates=[]),this.lastErrorStates.push(t.state);var n=this.getErrorRecoverySet(t);this.consumeUntil(t,n)}},{key:"sync",value:function(t){if(!this.inErrorRecoveryMode(t)){var e=t._interp.atn.states[t.state],n=t.getTokenStream().LA(1),r=t.atn.nextTokens(e);if(r.contains(n))return this.nextTokensContext=null,void(this.nextTokenState=H.INVALID_STATE_NUMBER);if(r.contains(o.EPSILON))null===this.nextTokensContext&&(this.nextTokensContext=t._ctx,this.nextTokensState=t._stateNumber);else switch(e.stateType){case H.BLOCK_START:case H.STAR_BLOCK_START:case H.PLUS_BLOCK_START:case H.STAR_LOOP_ENTRY:if(null!==this.singleTokenDeletion(t))return;throw new Pc(t);case H.PLUS_LOOP_BACK:case H.STAR_LOOP_BACK:this.reportUnwantedToken(t);var i=new V;i.addSet(t.getExpectedTokens());var u=i.addSet(this.getErrorRecoverySet(t));this.consumeUntil(t,u)}}}},{key:"reportNoViableAlternative",value:function(t,e){var n,r=t.getTokenStream();n=null!==r?e.startToken.type===o.EOF?"<EOF>":r.getText(new B(e.startToken.tokenIndex,e.offendingToken.tokenIndex)):"<unknown input>";var i="no viable alternative at input "+this.escapeWSAndQuote(n);t.notifyErrorListeners(i,e.offendingToken,e)}},{key:"reportInputMismatch",value:function(t,e){var n="mismatched input "+this.getTokenErrorDisplay(e.offendingToken)+" expecting "+e.getExpectedTokens().toString(t.literalNames,t.symbolicNames);t.notifyErrorListeners(n,e.offendingToken,e)}},{key:"reportFailedPredicate",value:function(t,e){var n="rule "+t.ruleNames[t._ctx.ruleIndex]+" "+e.message;t.notifyErrorListeners(n,e.offendingToken,e)}},{key:"reportUnwantedToken",value:function(t){if(!this.inErrorRecoveryMode(t)){this.beginErrorCondition(t);var e=t.getCurrentToken(),n="extraneous input "+this.getTokenErrorDisplay(e)+" expecting "+this.getExpectedTokens(t).toString(t.literalNames,t.symbolicNames);t.notifyErrorListeners(n,e,null)}}},{key:"reportMissingToken",value:function(t){if(!this.inErrorRecoveryMode(t)){this.beginErrorCondition(t);var e=t.getCurrentToken(),n="missing "+this.getExpectedTokens(t).toString(t.literalNames,t.symbolicNames)+" at "+this.getTokenErrorDisplay(e);t.notifyErrorListeners(n,e,null)}}},{key:"recoverInline",value:function(t){var e=this.singleTokenDeletion(t);if(null!==e)return t.consume(),e;if(this.singleTokenInsertion(t))return this.getMissingSymbol(t);throw new Pc(t)}},{key:"singleTokenInsertion",value:function(t){var e=t.getTokenStream().LA(1),n=t._interp.atn,r=n.states[t.state].transitions[0].target;return!!n.nextTokens(r,t._ctx).contains(e)&&(this.reportMissingToken(t),!0)}},{key:"singleTokenDeletion",value:function(t){var e=t.getTokenStream().LA(2);if(this.getExpectedTokens(t).contains(e)){this.reportUnwantedToken(t),t.consume();var n=t.getCurrentToken();return this.reportMatch(t),n}return null}},{key:"getMissingSymbol",value:function(t){var e,n=t.getCurrentToken(),r=this.getExpectedTokens(t).first();e=r===o.EOF?"<missing EOF>":"<missing "+t.literalNames[r]+">";var i=n,u=t.getTokenStream().LT(-1);return i.type===o.EOF&&null!==u&&(i=u),t.getTokenFactory().create(i.source,r,e,o.DEFAULT_CHANNEL,-1,-1,i.line,i.column)}},{key:"getExpectedTokens",value:function(t){return t.getExpectedTokens()}},{key:"getTokenErrorDisplay",value:function(t){if(null===t)return"<no token>";var e=t.text;return null===e&&(e=t.type===o.EOF?"<EOF>":"<"+t.type+">"),this.escapeWSAndQuote(e)}},{key:"escapeWSAndQuote",value:function(t){return"'"+(t=(t=(t=t.replace(/\n/g,"\\n")).replace(/\r/g,"\\r")).replace(/\t/g,"\\t"))+"'"}},{key:"getErrorRecoverySet",value:function(t){for(var e=t._interp.atn,n=t._ctx,r=new V;null!==n&&n.invokingState>=0;){var i=e.states[n.invokingState].transitions[0],u=e.nextTokens(i.followState);r.addSet(u),n=n.parentCtx}return r.removeOne(o.EPSILON),r}},{key:"consumeUntil",value:function(t,e){for(var n=t.getTokenStream().LA(1);n!==o.EOF&&!e.contains(n);)t.consume(),n=t.getTokenStream().LA(1)}}],n&&Yc(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),c}(function(){function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t)}var e,n;return e=t,(n=[{key:"reset",value:function(t){}},{key:"recoverInline",value:function(t){}},{key:"recover",value:function(t,e){}},{key:"sync",value:function(t){}},{key:"inErrorRecoveryMode",value:function(t){}},{key:"reportError",value:function(t){}}])&&Hc(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}());function $c(t){return $c="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},$c(t)}function Jc(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==$c(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==$c(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===$c(o)?o:String(o)),r)}var o}function Qc(t,e){return Qc=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Qc(t,e)}function Zc(t){return Zc=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Zc(t)}var ta=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Qc(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Zc(r);if(o){var n=Zc(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===$c(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),i.call(this)}return e=u,n=[{key:"recover",value:function(t,e){for(var n=t._ctx;null!==n;)n.exception=e,n=n.parentCtx;throw new zc(e)}},{key:"recoverInline",value:function(t){this.recover(t,new Pc(t))}},{key:"sync",value:function(t){}}],n&&Jc(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Xc);const ea={RecognitionException:xi,NoViableAltException:Bu,LexerNoViableAltException:Ii,InputMismatchException:Pc,FailedPredicateException:jc,DiagnosticErrorListener:Ic,BailErrorStrategy:ta,DefaultErrorStrategy:Xc,ErrorListener:Go};function na(t){return na="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},na(t)}function ra(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==na(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==na(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===na(o)?o:String(o)),r)}var o}var oa=function(){function t(e,n){if(function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.name="<empty>",this.strdata=e,this.decodeToUnicodeCodePoints=n||!1,this._index=0,this.data=[],this.decodeToUnicodeCodePoints)for(var r=0;r<this.strdata.length;){var o=this.strdata.codePointAt(r);this.data.push(o),r+=o<=65535?1:2}else{this.data=new Array(this.strdata.length);for(var i=0;i<this.strdata.length;i++)this.data[i]=this.strdata.charCodeAt(i)}this._size=this.data.length}var e,n;return e=t,n=[{key:"reset",value:function(){this._index=0}},{key:"consume",value:function(){if(this._index>=this._size)throw"cannot consume EOF";this._index+=1}},{key:"LA",value:function(t){if(0===t)return 0;t<0&&(t+=1);var e=this._index+t-1;return e<0||e>=this._size?o.EOF:this.data[e]}},{key:"LT",value:function(t){return this.LA(t)}},{key:"mark",value:function(){return-1}},{key:"release",value:function(t){}},{key:"seek",value:function(t){t<=this._index?this._index=t:this._index=Math.min(t,this._size)}},{key:"getText",value:function(t,e){if(e>=this._size&&(e=this._size-1),t>=this._size)return"";if(this.decodeToUnicodeCodePoints){for(var n="",r=t;r<=e;r++)n+=String.fromCodePoint(this.data[r]);return n}return this.strdata.slice(t,e+1)}},{key:"toString",value:function(){return this.strdata}},{key:"index",get:function(){return this._index}},{key:"size",get:function(){return this._size}}],n&&ra(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),t}();function ia(t){return ia="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ia(t)}function ua(t,e){return ua=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},ua(t,e)}function ca(t){return ca=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},ca(t)}var aa=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&ua(t,e)}(i,t);var e,n,r,o=(n=i,r=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=ca(n);if(r){var o=ca(this).constructor;t=Reflect.construct(e,arguments,o)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===ia(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function i(t,e){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,i),o.call(this,t,e)}return e=i,Object.defineProperty(e,"prototype",{writable:!1}),e}(oa),la=n(92);function sa(t){return sa="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},sa(t)}function fa(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==sa(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==sa(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===sa(o)?o:String(o)),r)}var o}function pa(t,e){return pa=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},pa(t,e)}function ya(t){return ya=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},ya(t)}var ha="undefined"!=typeof process&&null!=process.versions&&null!=process.versions.node,ba=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&pa(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=ya(r);if(o){var n=ya(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===sa(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e,n){var r;if(function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),!ha)throw new Error("FileStream is only available when running in Node!");var o=la.readFileSync(t,e||"utf-8");return(r=i.call(this,o,n)).fileName=t,r}return e=u,n=[{key:"fromPath",value:function(t,e,n){if(!ha)throw new Error("FileStream is only available when running in Node!");la.readFile(t,e,(function(t,e){var r=null;null!==e&&(r=new oa(e,!0)),n(t,r)}))}}],null&&0,n&&fa(e,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(aa);const va={fromString:function(t){return new oa(t,!0)},fromBlob:function(t,e,n,r){var o=new window.FileReader;o.onload=function(t){var e=new oa(t.target.result,!0);n(e)},o.onerror=r,o.readAsText(t,e)},fromBuffer:function(t,e){return new oa(t.toString(e),!0)},fromPath:function(t,e,n){ba.fromPath(t,e,n)},fromPathSync:function(t,e){return new ba(t,e)}},da={arrayToString:b,stringToCharArray:function(t){for(var e=new Uint16Array(t.length),n=0;n<t.length;n++)e[n]=t.charCodeAt(n);return e}};function ma(t){return ma="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ma(t)}function ga(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==ma(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==ma(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===ma(o)?o:String(o)),r)}var o}function Sa(t,e,n){return e&&ga(t.prototype,e),n&&ga(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t}function Oa(t){return Oa="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Oa(t)}function wa(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Oa(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Oa(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Oa(o)?o:String(o)),r)}var o}function _a(t,e){return _a=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},_a(t,e)}function Pa(t){return Pa=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Pa(t)}var Ta=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&_a(t,e)}(c,t);var e,n,r,i,u=(r=c,i=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Pa(r);if(i){var n=Pa(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Oa(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function c(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,c),(e=u.call(this)).tokenSource=t,e.tokens=[],e.index=-1,e.fetchedEOF=!1,e}return e=c,n=[{key:"mark",value:function(){return 0}},{key:"release",value:function(t){}},{key:"reset",value:function(){this.seek(0)}},{key:"seek",value:function(t){this.lazyInit(),this.index=this.adjustSeekIndex(t)}},{key:"size",get:function(){return this.tokens.length}},{key:"get",value:function(t){return this.lazyInit(),this.tokens[t]}},{key:"consume",value:function(){if(!(this.index>=0&&(this.fetchedEOF?this.index<this.tokens.length-1:this.index<this.tokens.length))&&this.LA(1)===o.EOF)throw"cannot consume EOF";this.sync(this.index+1)&&(this.index=this.adjustSeekIndex(this.index+1))}},{key:"sync",value:function(t){var e=t-this.tokens.length+1;return!(e>0)||this.fetch(e)>=e}},{key:"fetch",value:function(t){if(this.fetchedEOF)return 0;for(var e=0;e<t;e++){var n=this.tokenSource.nextToken();if(n.tokenIndex=this.tokens.length,this.tokens.push(n),n.type===o.EOF)return this.fetchedEOF=!0,e+1}return t}},{key:"getTokens",value:function(t,e,n){if(void 0===n&&(n=null),t<0||e<0)return null;this.lazyInit();var r=[];e>=this.tokens.length&&(e=this.tokens.length-1);for(var i=t;i<e;i++){var u=this.tokens[i];if(u.type===o.EOF)break;(null===n||n.contains(u.type))&&r.push(u)}return r}},{key:"LA",value:function(t){return this.LT(t).type}},{key:"LB",value:function(t){return this.index-t<0?null:this.tokens[this.index-t]}},{key:"LT",value:function(t){if(this.lazyInit(),0===t)return null;if(t<0)return this.LB(-t);var e=this.index+t-1;return this.sync(e),e>=this.tokens.length?this.tokens[this.tokens.length-1]:this.tokens[e]}},{key:"adjustSeekIndex",value:function(t){return t}},{key:"lazyInit",value:function(){-1===this.index&&this.setup()}},{key:"setup",value:function(){this.sync(0),this.index=this.adjustSeekIndex(0)}},{key:"setTokenSource",value:function(t){this.tokenSource=t,this.tokens=[],this.index=-1,this.fetchedEOF=!1}},{key:"nextTokenOnChannel",value:function(t,e){if(this.sync(t),t>=this.tokens.length)return-1;for(var n=this.tokens[t];n.channel!==this.channel;){if(n.type===o.EOF)return-1;t+=1,this.sync(t),n=this.tokens[t]}return t}},{key:"previousTokenOnChannel",value:function(t,e){for(;t>=0&&this.tokens[t].channel!==e;)t-=1;return t}},{key:"getHiddenTokensToRight",value:function(t,e){if(void 0===e&&(e=-1),this.lazyInit(),t<0||t>=this.tokens.length)throw t+" not in 0.."+this.tokens.length-1;var n=this.nextTokenOnChannel(t+1,Ui.DEFAULT_TOKEN_CHANNEL),r=t+1,o=-1===n?this.tokens.length-1:n;return this.filterForChannel(r,o,e)}},{key:"getHiddenTokensToLeft",value:function(t,e){if(void 0===e&&(e=-1),this.lazyInit(),t<0||t>=this.tokens.length)throw t+" not in 0.."+this.tokens.length-1;var n=this.previousTokenOnChannel(t-1,Ui.DEFAULT_TOKEN_CHANNEL);if(n===t-1)return null;var r=n+1,o=t-1;return this.filterForChannel(r,o,e)}},{key:"filterForChannel",value:function(t,e,n){for(var r=[],o=t;o<e+1;o++){var i=this.tokens[o];-1===n?i.channel!==Ui.DEFAULT_TOKEN_CHANNEL&&r.push(i):i.channel===n&&r.push(i)}return 0===r.length?null:r}},{key:"getSourceName",value:function(){return this.tokenSource.getSourceName()}},{key:"getText",value:function(t){this.lazyInit(),this.fill(),t||(t=new B(0,this.tokens.length-1));var e=t.start;e instanceof o&&(e=e.tokenIndex);var n=t.stop;if(n instanceof o&&(n=n.tokenIndex),null===e||null===n||e<0||n<0)return"";n>=this.tokens.length&&(n=this.tokens.length-1);for(var r="",i=e;i<n+1;i++){var u=this.tokens[i];if(u.type===o.EOF)break;r+=u.text}return r}},{key:"fill",value:function(){for(this.lazyInit();1e3===this.fetch(1e3););}}],n&&wa(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),c}(Sa((function t(){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t)})));function Ea(t){return Ea="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ea(t)}function ka(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Ea(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Ea(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Ea(o)?o:String(o)),r)}var o}function ja(t,e){return ja=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},ja(t,e)}function xa(t){return xa=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},xa(t)}Object.defineProperty(Ta,"size",{get:function(){return this.tokens.length}});var Ra=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&ja(t,e)}(c,t);var e,n,r,i,u=(r=c,i=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=xa(r);if(i){var n=xa(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Ea(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function c(t,e){var n;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,c),(n=u.call(this,t)).channel=void 0===e?o.DEFAULT_CHANNEL:e,n}return e=c,n=[{key:"adjustSeekIndex",value:function(t){return this.nextTokenOnChannel(t,this.channel)}},{key:"LB",value:function(t){if(0===t||this.index-t<0)return null;for(var e=this.index,n=1;n<=t;)e=this.previousTokenOnChannel(e-1,this.channel),n+=1;return e<0?null:this.tokens[e]}},{key:"LT",value:function(t){if(this.lazyInit(),0===t)return null;if(t<0)return this.LB(-t);for(var e=this.index,n=1;n<t;)this.sync(e+1)&&(e=this.nextTokenOnChannel(e+1,this.channel)),n+=1;return this.tokens[e]}},{key:"getNumberOfOnChannelTokens",value:function(){var t=0;this.fill();for(var e=0;e<this.tokens.length;e++){var n=this.tokens[e];if(n.channel===this.channel&&(t+=1),n.type===o.EOF)break}return t}}],n&&ka(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),c}(Ta);function Ca(t){return Ca="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ca(t)}function Aa(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Ca(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Ca(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Ca(o)?o:String(o)),r)}var o}function Na(t,e){return Na=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Na(t,e)}function Ia(t){return Ia=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Ia(t)}var La=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Na(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Ia(r);if(o){var n=Ia(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Ca(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(e=i.call(this)).parser=t,e}return e=u,(n=[{key:"enterEveryRule",value:function(t){console.log("enter   "+this.parser.ruleNames[t.ruleIndex]+", LT(1)="+this.parser._input.LT(1).text)}},{key:"visitTerminal",value:function(t){console.log("consume "+t.symbol+" rule "+this.parser.ruleNames[this.parser._ctx.ruleIndex])}},{key:"exitEveryRule",value:function(t){console.log("exit    "+this.parser.ruleNames[t.ruleIndex]+", LT(1)="+this.parser._input.LT(1).text)}}])&&Aa(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(yc);function Da(t){return Da="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Da(t)}function Fa(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Da(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Da(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Da(o)?o:String(o)),r)}var o}function Ba(t,e){return Ba=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Ba(t,e)}function Ma(t){return Ma=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Ma(t)}var Ua=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Ba(t,e)}(c,t);var e,n,r,i,u=(r=c,i=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Ma(r);if(i){var n=Ma(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Da(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function c(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,c),(e=u.call(this))._input=null,e._errHandler=new Xc,e._precedenceStack=[],e._precedenceStack.push(0),e._ctx=null,e.buildParseTrees=!0,e._tracer=null,e._parseListeners=null,e._syntaxErrors=0,e.setInputStream(t),e}return e=c,n=[{key:"reset",value:function(){null!==this._input&&this._input.seek(0),this._errHandler.reset(this),this._ctx=null,this._syntaxErrors=0,this.setTrace(!1),this._precedenceStack=[],this._precedenceStack.push(0),null!==this._interp&&this._interp.reset()}},{key:"match",value:function(t){var e=this.getCurrentToken();return e.type===t?(this._errHandler.reportMatch(this),this.consume()):(e=this._errHandler.recoverInline(this),this.buildParseTrees&&-1===e.tokenIndex&&this._ctx.addErrorNode(e)),e}},{key:"matchWildcard",value:function(){var t=this.getCurrentToken();return t.type>0?(this._errHandler.reportMatch(this),this.consume()):(t=this._errHandler.recoverInline(this),this.buildParseTrees&&-1===t.tokenIndex&&this._ctx.addErrorNode(t)),t}},{key:"getParseListeners",value:function(){return this._parseListeners||[]}},{key:"addParseListener",value:function(t){if(null===t)throw"listener";null===this._parseListeners&&(this._parseListeners=[]),this._parseListeners.push(t)}},{key:"removeParseListener",value:function(t){if(null!==this._parseListeners){var e=this._parseListeners.indexOf(t);e>=0&&this._parseListeners.splice(e,1),0===this._parseListeners.length&&(this._parseListeners=null)}}},{key:"removeParseListeners",value:function(){this._parseListeners=null}},{key:"triggerEnterRuleEvent",value:function(){if(null!==this._parseListeners){var t=this._ctx;this._parseListeners.forEach((function(e){e.enterEveryRule(t),t.enterRule(e)}))}}},{key:"triggerExitRuleEvent",value:function(){if(null!==this._parseListeners){var t=this._ctx;this._parseListeners.slice(0).reverse().forEach((function(e){t.exitRule(e),e.exitEveryRule(t)}))}}},{key:"getTokenFactory",value:function(){return this._input.tokenSource._factory}},{key:"setTokenFactory",value:function(t){this._input.tokenSource._factory=t}},{key:"getATNWithBypassAlts",value:function(){var t=this.getSerializedATN();if(null===t)throw"The current parser does not support an ATN with bypass alternatives.";var e=this.bypassAltsAtnCache[t];if(null===e){var n=new $r;n.generateRuleBypassTransitions=!0,e=new Ho(n).deserialize(t),this.bypassAltsAtnCache[t]=e}return e}},{key:"getInputStream",value:function(){return this.getTokenStream()}},{key:"setInputStream",value:function(t){this.setTokenStream(t)}},{key:"getTokenStream",value:function(){return this._input}},{key:"setTokenStream",value:function(t){this._input=null,this.reset(),this._input=t}},{key:"syntaxErrorsCount",get:function(){return this._syntaxErrors}},{key:"getCurrentToken",value:function(){return this._input.LT(1)}},{key:"notifyErrorListeners",value:function(t,e,n){n=n||null,null===(e=e||null)&&(e=this.getCurrentToken()),this._syntaxErrors+=1;var r=e.line,o=e.column;this.getErrorListenerDispatch().syntaxError(this,e,r,o,t,n)}},{key:"consume",value:function(){var t=this.getCurrentToken();t.type!==o.EOF&&this.getInputStream().consume();var e,n=null!==this._parseListeners&&this._parseListeners.length>0;return(this.buildParseTrees||n)&&((e=this._errHandler.inErrorRecoveryMode(this)?this._ctx.addErrorNode(t):this._ctx.addTokenNode(t)).invokingState=this.state,n&&this._parseListeners.forEach((function(t){e instanceof Wt||void 0!==e.isErrorNode&&e.isErrorNode()?t.visitErrorNode(e):e instanceof Ht&&t.visitTerminal(e)}))),t}},{key:"addContextToParseTree",value:function(){null!==this._ctx.parentCtx&&this._ctx.parentCtx.addChild(this._ctx)}},{key:"enterRule",value:function(t,e,n){this.state=e,this._ctx=t,this._ctx.start=this._input.LT(1),this.buildParseTrees&&this.addContextToParseTree(),this.triggerEnterRuleEvent()}},{key:"exitRule",value:function(){this._ctx.stop=this._input.LT(-1),this.triggerExitRuleEvent(),this.state=this._ctx.invokingState,this._ctx=this._ctx.parentCtx}},{key:"enterOuterAlt",value:function(t,e){t.setAltNumber(e),this.buildParseTrees&&this._ctx!==t&&null!==this._ctx.parentCtx&&(this._ctx.parentCtx.removeLastChild(),this._ctx.parentCtx.addChild(t)),this._ctx=t}},{key:"getPrecedence",value:function(){return 0===this._precedenceStack.length?-1:this._precedenceStack[this._precedenceStack.length-1]}},{key:"enterRecursionRule",value:function(t,e,n,r){this.state=e,this._precedenceStack.push(r),this._ctx=t,this._ctx.start=this._input.LT(1),this.triggerEnterRuleEvent()}},{key:"pushNewRecursionContext",value:function(t,e,n){var r=this._ctx;r.parentCtx=t,r.invokingState=e,r.stop=this._input.LT(-1),this._ctx=t,this._ctx.start=r.start,this.buildParseTrees&&this._ctx.addChild(r),this.triggerEnterRuleEvent()}},{key:"unrollRecursionContexts",value:function(t){this._precedenceStack.pop(),this._ctx.stop=this._input.LT(-1);var e=this._ctx,n=this.getParseListeners();if(null!==n&&n.length>0)for(;this._ctx!==t;)this.triggerExitRuleEvent(),this._ctx=this._ctx.parentCtx;else this._ctx=t;e.parentCtx=t,this.buildParseTrees&&null!==t&&t.addChild(e)}},{key:"getInvokingContext",value:function(t){for(var e=this._ctx;null!==e;){if(e.ruleIndex===t)return e;e=e.parentCtx}return null}},{key:"precpred",value:function(t,e){return e>=this._precedenceStack[this._precedenceStack.length-1]}},{key:"inContext",value:function(t){return!1}},{key:"isExpectedToken",value:function(t){var e=this._interp.atn,n=this._ctx,r=e.states[this.state],i=e.nextTokens(r);if(i.contains(t))return!0;if(!i.contains(o.EPSILON))return!1;for(;null!==n&&n.invokingState>=0&&i.contains(o.EPSILON);){var u=e.states[n.invokingState].transitions[0];if((i=e.nextTokens(u.followState)).contains(t))return!0;n=n.parentCtx}return!(!i.contains(o.EPSILON)||t!==o.EOF)}},{key:"getExpectedTokens",value:function(){return this._interp.atn.getExpectedTokens(this.state,this._ctx)}},{key:"getExpectedTokensWithinCurrentRule",value:function(){var t=this._interp.atn,e=t.states[this.state];return t.nextTokens(e)}},{key:"getRuleIndex",value:function(t){var e=this.getRuleIndexMap()[t];return null!==e?e:-1}},{key:"getRuleInvocationStack",value:function(t){null===(t=t||null)&&(t=this._ctx);for(var e=[];null!==t;){var n=t.ruleIndex;n<0?e.push("n/a"):e.push(this.ruleNames[n]),t=t.parentCtx}return e}},{key:"getDFAStrings",value:function(){return this._interp.decisionToDFA.toString()}},{key:"dumpDFA",value:function(){for(var t=!1,e=0;e<this._interp.decisionToDFA.length;e++){var n=this._interp.decisionToDFA[e];n.states.length>0&&(t&&console.log(),this.printer.println("Decision "+n.decision+":"),this.printer.print(n.toString(this.literalNames,this.symbolicNames)),t=!0)}}},{key:"getSourceName",value:function(){return this._input.sourceName}},{key:"setTrace",value:function(t){t?(null!==this._tracer&&this.removeParseListener(this._tracer),this._tracer=new La(this),this.addParseListener(this._tracer)):(this.removeParseListener(this._tracer),this._tracer=null)}}],n&&Fa(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),c}(ai);function Va(t){return Va="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Va(t)}function za(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Va(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Va(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Va(o)?o:String(o)),r)}var o}function qa(t,e){return qa=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},qa(t,e)}function Ha(t){return Ha=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Ha(t)}Ua.bypassAltsAtnCache={};var Ka=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&qa(t,e)}(c,t);var e,n,r,i,u=(r=c,i=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Ha(r);if(i){var n=Ha(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Va(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function c(t){var e;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,c),(e=u.call(this)).parentCtx=null,e.symbol=t,e}return e=c,(n=[{key:"getChild",value:function(t){return null}},{key:"getSymbol",value:function(){return this.symbol}},{key:"getParent",value:function(){return this.parentCtx}},{key:"getPayload",value:function(){return this.symbol}},{key:"getSourceInterval",value:function(){if(null===this.symbol)return B.INVALID_INTERVAL;var t=this.symbol.tokenIndex;return new B(t,t)}},{key:"getChildCount",value:function(){return 0}},{key:"accept",value:function(t){return t.visitTerminal(this)}},{key:"getText",value:function(){return this.symbol.text}},{key:"toString",value:function(){return this.symbol.type===o.EOF?"<EOF>":this.symbol.text}}])&&za(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),c}(Ht);function Ya(t){return Ya="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ya(t)}function Ga(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Ya(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Ya(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Ya(o)?o:String(o)),r)}var o}function Wa(t,e){return Wa=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Wa(t,e)}function Xa(t){return Xa=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},Xa(t)}var $a=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Wa(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=Xa(r);if(o){var n=Xa(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Ya(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t){return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),i.call(this,t)}return e=u,(n=[{key:"isErrorNode",value:function(){return!0}},{key:"accept",value:function(t){return t.visitErrorNode(this)}}])&&Ga(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(Ka);function Ja(t){return Ja="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},Ja(t)}function Qa(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,(void 0,o=function(t,e){if("object"!==Ja(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==Ja(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key),"symbol"===Ja(o)?o:String(o)),r)}var o}function Za(t,e){return Za=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},Za(t,e)}function tl(t){return tl=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},tl(t)}var el=function(t){!function(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&Za(t,e)}(u,t);var e,n,r,o,i=(r=u,o=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}(),function(){var t,e=tl(r);if(o){var n=tl(this).constructor;t=Reflect.construct(e,arguments,n)}else t=e.apply(this,arguments);return function(t,e){if(e&&("object"===Ja(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,t)});function u(t,e){var n;return function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,u),(n=i.call(this,t,e)).children=null,n.start=null,n.stop=null,n.exception=null,n}return e=u,n=[{key:"copyFrom",value:function(t){this.parentCtx=t.parentCtx,this.invokingState=t.invokingState,this.children=null,this.start=t.start,this.stop=t.stop,t.children&&(this.children=[],t.children.map((function(t){t instanceof $a&&(this.children.push(t),t.parentCtx=this)}),this))}},{key:"enterRule",value:function(t){}},{key:"exitRule",value:function(t){}},{key:"addChild",value:function(t){return null===this.children&&(this.children=[]),this.children.push(t),t}},{key:"removeLastChild",value:function(){null!==this.children&&this.children.pop()}},{key:"addTokenNode",value:function(t){var e=new Ka(t);return this.addChild(e),e.parentCtx=this,e}},{key:"addErrorNode",value:function(t){var e=new $a(t);return this.addChild(e),e.parentCtx=this,e}},{key:"getChild",value:function(t,e){if(e=e||null,null===this.children||t<0||t>=this.children.length)return null;if(null===e)return this.children[t];for(var n=0;n<this.children.length;n++){var r=this.children[n];if(r instanceof e){if(0===t)return r;t-=1}}return null}},{key:"getToken",value:function(t,e){if(null===this.children||e<0||e>=this.children.length)return null;for(var n=0;n<this.children.length;n++){var r=this.children[n];if(r instanceof Ht&&r.symbol.type===t){if(0===e)return r;e-=1}}return null}},{key:"getTokens",value:function(t){if(null===this.children)return[];for(var e=[],n=0;n<this.children.length;n++){var r=this.children[n];r instanceof Ht&&r.symbol.type===t&&e.push(r)}return e}},{key:"getTypedRuleContext",value:function(t,e){return this.getChild(e,t)}},{key:"getTypedRuleContexts",value:function(t){if(null===this.children)return[];for(var e=[],n=0;n<this.children.length;n++){var r=this.children[n];r instanceof t&&e.push(r)}return e}},{key:"getChildCount",value:function(){return null===this.children?0:this.children.length}},{key:"getSourceInterval",value:function(){return null===this.start||null===this.stop?B.INVALID_INTERVAL:new B(this.start.tokenIndex,this.stop.tokenIndex)}}],n&&Qa(e.prototype,n),Object.defineProperty(e,"prototype",{writable:!1}),u}(ee);function nl(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&rl(t,e)}function rl(t,e){return rl=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},rl(t,e)}function ol(t){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(t){return!1}}();return function(){var n,r=il(t);if(e){var o=il(this).constructor;n=Reflect.construct(r,arguments,o)}else n=r.apply(this,arguments);return function(t,e){if(e&&("object"===ul(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}(t)}(this,n)}}function il(t){return il=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},il(t)}function ul(t){return ul="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ul(t)}function cl(t,e){var n="undefined"!=typeof Symbol&&t[Symbol.iterator]||t["@@iterator"];if(!n){if(Array.isArray(t)||(n=function(t,e){if(t){if("string"==typeof t)return al(t,e);var n=Object.prototype.toString.call(t).slice(8,-1);return"Object"===n&&t.constructor&&(n=t.constructor.name),"Map"===n||"Set"===n?Array.from(t):"Arguments"===n||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?al(t,e):void 0}}(t))||e&&t&&"number"==typeof t.length){n&&(t=n);var r=0,o=function(){};return{s:o,n:function(){return r>=t.length?{done:!0}:{done:!1,value:t[r++]}},e:function(t){throw t},f:o}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}var i,u=!0,c=!1;return{s:function(){n=n.call(t)},n:function(){var t=n.next();return u=t.done,t},e:function(t){c=!0,i=t},f:function(){try{u||null==n.return||n.return()}finally{if(c)throw i}}}}function al(t,e){(null==e||e>t.length)&&(e=t.length);for(var n=0,r=new Array(e);n<e;n++)r[n]=t[n];return r}function ll(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function sl(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,pl(r.key),r)}}function fl(t,e,n){return e&&sl(t.prototype,e),n&&sl(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t}function pl(t){var e=function(t,e){if("object"!==ul(t)||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,"string");if("object"!==ul(r))return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(t);return"symbol"===ul(e)?e:String(e)}ee.EMPTY=new el;var yl,hl,bl,vl=function(){function t(e){ll(this,t),this.tokens=e,this.programs=new Map}return fl(t,[{key:"getTokenStream",value:function(){return this.tokens}},{key:"insertAfter",value:function(e,n){var r,o=arguments.length>2&&void 0!==arguments[2]?arguments[2]:t.DEFAULT_PROGRAM_NAME;r="number"==typeof e?e:e.tokenIndex;var i=this.getProgram(o),u=new gl(this.tokens,r,i.length,n);i.push(u)}},{key:"insertBefore",value:function(e,n){var r,o=arguments.length>2&&void 0!==arguments[2]?arguments[2]:t.DEFAULT_PROGRAM_NAME;r="number"==typeof e?e:e.tokenIndex;var i=this.getProgram(o),u=new ml(this.tokens,r,i.length,n);i.push(u)}},{key:"replaceSingle",value:function(e,n){var r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:t.DEFAULT_PROGRAM_NAME;this.replace(e,e,n,r)}},{key:"replace",value:function(e,n,r){var o=arguments.length>3&&void 0!==arguments[3]?arguments[3]:t.DEFAULT_PROGRAM_NAME;if("number"!=typeof e&&(e=e.tokenIndex),"number"!=typeof n&&(n=n.tokenIndex),e>n||e<0||n<0||n>=this.tokens.size)throw new RangeError("replace: range invalid: ".concat(e,"..").concat(n,"(size=").concat(this.tokens.size,")"));var i=this.getProgram(o),u=new Sl(this.tokens,e,n,i.length,r);i.push(u)}},{key:"delete",value:function(e,n){var r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:t.DEFAULT_PROGRAM_NAME;void 0===n&&(n=e),this.replace(e,n,null,r)}},{key:"getProgram",value:function(t){var e=this.programs.get(t);return null==e&&(e=this.initializeProgram(t)),e}},{key:"initializeProgram",value:function(t){var e=[];return this.programs.set(t,e),e}},{key:"getText",value:function(e){var n,r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:t.DEFAULT_PROGRAM_NAME;n=e instanceof B?e:new B(0,this.tokens.size-1),"string"==typeof e&&(r=e);var i=this.programs.get(r),u=n.start,c=n.stop;if(c>this.tokens.size-1&&(c=this.tokens.size-1),u<0&&(u=0),null==i||0===i.length)return this.tokens.getText(new B(u,c));for(var a=[],l=this.reduceToSingleOperationPerIndex(i),s=u;s<=c&&s<this.tokens.size;){var f=l.get(s);l.delete(s);var p=this.tokens.get(s);null==f?(p.type!==o.EOF&&a.push(String(p.text)),s++):s=f.execute(a)}if(c===this.tokens.size-1){var y,h=cl(l.values());try{for(h.s();!(y=h.n()).done;){var b=y.value;b.index>=this.tokens.size-1&&a.push(b.text.toString())}}catch(t){h.e(t)}finally{h.f()}}return a.join("")}},{key:"reduceToSingleOperationPerIndex",value:function(t){for(var e=0;e<t.length;e++){var n=t[e];if(null!=n&&n instanceof Sl){var r,o=n,i=cl(this.getKindOfOps(t,ml,e));try{for(i.s();!(r=i.n()).done;){var u=r.value;u.index===o.index?(t[u.instructionIndex]=void 0,o.text=u.text.toString()+(null!=o.text?o.text.toString():"")):u.index>o.index&&u.index<=o.lastIndex&&(t[u.instructionIndex]=void 0)}}catch(t){i.e(t)}finally{i.f()}var c,a=cl(this.getKindOfOps(t,Sl,e));try{for(a.s();!(c=a.n()).done;){var l=c.value;if(l.index>=o.index&&l.lastIndex<=o.lastIndex)t[l.instructionIndex]=void 0;else{var s=l.lastIndex<o.index||l.index>o.lastIndex;if(null!=l.text||null!=o.text||s){if(!s)throw new Error("replace op boundaries of ".concat(o," overlap with previous ").concat(l))}else t[l.instructionIndex]=void 0,o.index=Math.min(l.index,o.index),o.lastIndex=Math.max(l.lastIndex,o.lastIndex)}}}catch(t){a.e(t)}finally{a.f()}}}for(var f=0;f<t.length;f++){var p=t[f];if(null!=p&&p instanceof ml){var y,h=p,b=cl(this.getKindOfOps(t,ml,f));try{for(b.s();!(y=b.n()).done;){var v=y.value;v.index===h.index&&(v instanceof gl?(h.text=this.catOpText(v.text,h.text),t[v.instructionIndex]=void 0):v instanceof ml&&(h.text=this.catOpText(h.text,v.text),t[v.instructionIndex]=void 0))}}catch(t){b.e(t)}finally{b.f()}var d,m=cl(this.getKindOfOps(t,Sl,f));try{for(m.s();!(d=m.n()).done;){var g=d.value;if(h.index!==g.index){if(h.index>=g.index&&h.index<=g.lastIndex)throw new Error("insert op ".concat(h," within boundaries of previous ").concat(g))}else g.text=this.catOpText(h.text,g.text),t[f]=void 0}}catch(t){m.e(t)}finally{m.f()}}}var S,O=new Map,w=cl(t);try{for(w.s();!(S=w.n()).done;){var _=S.value;if(null!=_){if(null!=O.get(_.index))throw new Error("should only be one op per index");O.set(_.index,_)}}}catch(t){w.e(t)}finally{w.f()}return O}},{key:"catOpText",value:function(t,e){var n="",r="";return null!=t&&(n=t.toString()),null!=e&&(r=e.toString()),n+r}},{key:"getKindOfOps",value:function(t,e,n){return t.slice(0,n).filter((function(t){return t&&t instanceof e}))}}]),t}();yl=vl,bl="default",(hl=pl(hl="DEFAULT_PROGRAM_NAME"))in yl?Object.defineProperty(yl,hl,{value:bl,enumerable:!0,configurable:!0,writable:!0}):yl[hl]=bl;var dl=function(){function t(e,n,r,o){ll(this,t),this.tokens=e,this.instructionIndex=r,this.index=n,this.text=void 0===o?"":o}return fl(t,[{key:"toString",value:function(){var t=this.constructor.name,e=t.indexOf("$");return"<"+(t=t.substring(e+1,t.length))+"@"+this.tokens.get(this.index)+':"'+this.text+'">'}}]),t}(),ml=function(t){nl(n,t);var e=ol(n);function n(t,r,o,i){return ll(this,n),e.call(this,t,r,o,i)}return fl(n,[{key:"execute",value:function(t){return this.text&&t.push(this.text.toString()),this.tokens.get(this.index).type!==o.EOF&&t.push(String(this.tokens.get(this.index).text)),this.index+1}}]),n}(dl),gl=function(t){nl(n,t);var e=ol(n);function n(t,r,o,i){return ll(this,n),e.call(this,t,r+1,o,i)}return fl(n)}(ml),Sl=function(t){nl(n,t);var e=ol(n);function n(t,r,o,i,u){var c;return ll(this,n),(c=e.call(this,t,r,i,u)).lastIndex=o,c}return fl(n,[{key:"execute",value:function(t){return this.text&&t.push(this.text.toString()),this.lastIndex+1}},{key:"toString",value:function(){return null==this.text?"<DeleteOp@"+this.tokens.get(this.index)+".."+this.tokens.get(this.lastIndex)+">":"<ReplaceOp@"+this.tokens.get(this.index)+".."+this.tokens.get(this.lastIndex)+':"'+this.text+'">'}}]),n}(dl);const Ol={atn:$u,dfa:ac,context:lc,misc:sc,tree:Sc,error:ea,Token:o,CommonToken:yi,CharStreams:va,CharStream:aa,InputStream:aa,CommonTokenStream:Ra,Lexer:Ui,Parser:Ua,ParserRuleContext:el,Interval:B,IntervalSet:V,LL1Analyzer:Ie,Utils:da,TokenStreamRewriter:vl}})();var o=exports;for(var i in r)o[i]=r[i];r.__esModule&&Object.defineProperty(o,"__esModule",{value:!0})})();
//# sourceMappingURL=antlr4.web.cjs.map

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be in strict mode.
(() => {
"use strict";
var exports = __webpack_exports__;
/*!*********************!*\
  !*** ./src/main.ts ***!
  \*********************/

Object.defineProperty(exports, "__esModule", ({ value: true }));
const PrimaryPageLoader_1 = __webpack_require__(/*! ./PrimaryPageLoader */ "./src/PrimaryPageLoader.ts");
const ExpressionTestPageLoader_1 = __webpack_require__(/*! ./ExpressionTestPageLoader */ "./src/ExpressionTestPageLoader.ts");
const InputParseTestPage_1 = __webpack_require__(/*! ./InputParseTestPage */ "./src/InputParseTestPage.ts");
const SolverPageLoader_1 = __webpack_require__(/*! ./SolverPageLoader */ "./src/SolverPageLoader.ts");
window.onload = () => {
    setTimeout(function () {
        /**
          * Populate html elements by their class.
          */
        const classes = document.getElementsByTagName('body')[0].classList;
        if (classes.contains('expressionTestPage')) {
            (0, ExpressionTestPageLoader_1.loadExpressionsTestPage)();
        }
        else if (classes.contains('primaryIntegrator')) {
            (0, PrimaryPageLoader_1.loadPrimaryPage)();
        }
        else if (classes.contains('inputParseTest')) {
            (0, InputParseTestPage_1.loadInputParseTestPage)();
        }
        else if (classes.contains('solve_in_steps')) {
            (0, SolverPageLoader_1.loadSolverPage)();
        }
    }, 100);
};

})();

/******/ })()
;
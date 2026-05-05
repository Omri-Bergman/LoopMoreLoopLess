// app.js — Word Poem Graph, path layout (left→right with alternates)
// Works with v1 JSON (neighbors.sem/orth/rhy) and v2 JSON (pos + edges)

let data, path = [], currentId = 0;
let voices = [];
let isMuted = false;
let speechInterval = null;
let speechIndex = 0;
let currentlySpeakingWord = ''; // Track the word currently being spoken
let mainFont; // ABCMaristVariableItalic-Trial.ttf for main words
let backgroundFont; // ABCFavoritExpanded-Light-Trial.otf for background word
let nodePositions = new Map(); // Store positions for nodes that were chosen from options
let currentLineColorEnd = [0, 0, 255]; // Current end color for lines (changes on each path/collapse)

// Cache for options to prevent flickering - only recalculate when path changes
let cachedTailOptions = null;
let cachedTailId = null;
let cachedPathLength = -1;

// Animation state
let animatingWord = null;  // {id, startX, startY, endX, endY, progress, startTime, chosenOptionIndex, fromNode}
let collapseAnimation = null; // {fromPath, toPath, startTime, progress}
let animationDuration = 500; // ms

// Click hit regions
let pathHit = [];   // rects for path words
let optionHit = []; // circles for the tail options
let showLessHit = []; // rects for "show less" buttons on path words
let showMoreHit = []; // rects for "show more" buttons on option words

// Color constants (all in RGB format)
const COLORS = {
  // Legend colors
  sem: [11, 132, 243],      // Blue - semantic relations
  orth: [244, 163, 0],      // Orange - similar writing
  rhy: [138, 43, 226],      // Blue violet - rhyme relations
  
  // Background colors
  background: [255, 253, 230],           // Cream background
  backgroundWord: [200, 200, 200],       // Light gray for background word
  
  // Text colors
  textDark: [17, 17, 17],                // Dark text (#111)
  textGray: [60, 60, 60],             // Gray text for buttons
  textDarkGray: [51, 51, 51],            // Dark gray text (#333)
  
  // Line and stroke colors
  lineColorStart: [0, 0, 0],              // Black - starting color for lines
  lineColorEnd: [0, 0, 255],               // Blue - ending color for lines (when path is long)
  strokeGray: [136, 136, 136]            // Gray stroke (#888)
};

// Line color transition settings
const LINE_COLOR_MAX_PATH_LENGTH = 15;     // Path length at which lines become fully blue

// Generate a random color for line end (avoiding too dark or too light colors)
function generateRandomLineColor() {
  // Generate colors in a nice range: avoid pure black/white, keep colors vibrant
  const hue = random(0, 360); // Full hue range
  const saturation = random(60, 100); // Keep colors vibrant (60-100%)
  const brightness = random(40, 80); // Avoid too dark or too light (40-80%)
  
  // Convert HSV to RGB
  const c = (brightness / 100) * (saturation / 100);
  const x = c * (1 - abs((hue / 60) % 2 - 1));
  const m = (brightness / 100) - c;
  
  let r, g, b;
  if (hue < 60) {
    r = c; g = x; b = 0;
  } else if (hue < 120) {
    r = x; g = c; b = 0;
  } else if (hue < 180) {
    r = 0; g = c; b = x;
  } else if (hue < 240) {
    r = 0; g = x; b = c;
  } else if (hue < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

// Typography constants
const TYPOGRAPHY = {
  mainWordSize: 24,                    // Font size for main path words and options
  buttonTextSize: 13,                  // Font size for "show less" and "show more" buttons
  legendTextSize: 13,                  // Font size for legend text
  backgroundWordSizeRatio: 0.9,        // Background word size as ratio of screen height (70%)
  backgroundWordMaxWidthRatio: 0.9,    // Maximum width as ratio of screen width (90% - 10% margin each side)
  backgroundWordLetterSpacingRatio: -0.02  // Letter spacing as ratio of font size (negative for condensed)
};

// ---------- Connectors (grammatical function words) ----------
const CONNECTORS = {  
  articles: ['a', 'an', 'the'],
  aux: ['is', 'was', 'are', 'were', 'has', 'have', 'had'],
  prepositions: ['in', 'on', 'at', 'to', 'for', 'of', 'with', 'without', 'from', 'into'],
  conjunctions: ['and', 'or', 'but', 'yet', 'so', 'if', 'when', 'while'], 
  negation: ['not', 'never', 'no'],
  other: ['is a', 'is not', 'was a', 'has a', 'and the', 'or the', 'but not']
};

// Context-aware connector suggestions based on POS
function getConnectorsForPOS(pos) {
  if (pos === 'NOUN') {
    return [...CONNECTORS.articles, ...CONNECTORS.aux, 'and', 'or', 'with', 'in', 'of'];
  }
  if (pos === 'VERB') {
    return [...CONNECTORS.articles, 'and', 'to', 'not', 'never', 'the', 'a'];
  }
  if (pos === 'ADJ') {
    return ['and', 'but', 'is', 'was', 'are', 'the', 'a', 'very'];
  }
  if (pos === 'ADV') {
    return ['and', 'but', 'very', 'quite', 'not'];
  }
  return ['and', 'or', 'the', 'a', 'is'];
}

// Check if path item is a connector
function isConnector(item) {
  return typeof item === 'object' && item !== null && item.type === 'connector';
}

// Get the last actual word ID from path (skip connectors)
function getLastWordId(pathArray) {
  for (let i = pathArray.length - 1; i >= 0; i--) {
    if (!isConnector(pathArray[i])) {
      return pathArray[i];
    }
  }
  return pathArray[0] || 0; // fallback
}

// Get word text from path item (handles both word IDs and connectors)
function getWordText(item) {
  if (isConnector(item)) {
    return item.text;
  }
  return data.words[item] || '';
}

// ---------- Data loading ----------
function preload(){
  // v1 dataset by default (works with v2 too)
  data = loadJSON('pulse_frame_word_graph_v2.json');
  // Load custom fonts
  mainFont = loadFont('Fonts/ABCMaristVariableItalic-Trial.ttf');
  backgroundFont = loadFont('Fonts/ABCGintoNordCondensed-Black-Trial.otf');
}

// ---------- Setup ----------
function setup(){
  createCanvas(windowWidth, windowHeight);
  if (mainFont) textFont(mainFont);
  textAlign(CENTER, CENTER);
  textSize(TYPOGRAPHY.mainWordSize);
  window.speechSynthesis.onvoiceschanged = () => voices = speechSynthesis.getVoices();
  // Start with "loop" (index 435 in pulse_frame_word_graph_v2.json)
  currentId = data && data.words ? data.words.indexOf('loop') : 0;
  if (currentId === -1) currentId = 0; // Fallback if "loop" not found
  path = [currentId];
  nodePositions.clear(); // Clear stored positions on reset
  currentLineColorEnd = generateRandomLineColor(); // Generate initial random color
  speakLoop();
}

function windowResized(){ resizeCanvas(windowWidth, windowHeight); }

// ---------- POS helpers (for v2 JSON) ----------
function getPOS(id){ return (data.pos && data.pos[id]) || null; }

function wantedTypesForPOS(pos){
  if (pos === 'NOUN') return ['verb4n','syn','rhy'];
  if (pos === 'VERB') return ['obj4v','adv4v','rhy'];
  if (pos === 'ADJ')  return ['noun4adj','syn','rhy'];
  if (pos === 'ADV')  return ['verb4adv','syn','rhy'];
  return ['syn','rhy']; // fallback
}

// ---------- Option picking (supports v1 and v2) ----------
function getThreeOptionsFor(id, useCache = true){
  // Check cache first to prevent flickering
  if (useCache && cachedTailId === id && cachedPathLength === path.length && cachedTailOptions !== null) {
    return cachedTailOptions;
  }

  // Ban every word already in the path to prevent loops (but allow connectors)
  const ban = new Set(path.filter(item => !isConnector(item)));
  
  // Check if current word is a connector - if so, don't allow connectors in next options
  const lastItem = path.length > 0 ? path[path.length - 1] : null;
  const currentIsConnector = isConnector(lastItem);

  // v2 path: edges + pos
  if (data.edges) {
    const E = data.edges[id] || {};
    const pos = getPOS(id) || 'NOUN';
    const want = wantedTypesForPOS(pos);
    const picks = [];
    const used = new Set([id, ...ban]);

    // Decision: sometimes offer a connector (30% chance, or if path is getting long)
    // BUT: never offer connector if current word is already a connector
    // Use a deterministic seed based on id and path length to ensure consistency
    // Use prime numbers for better distribution across different word ids
    const seed = ((id * 137) + (path.length * 97) + id) % 1000;
    const shouldOfferConnector = !currentIsConnector && ((seed / 1000) < 0.3 || path.length > 5);

    const takeFrom = (key) => {
      const arr = E[key] || [];
      for (const nid of arr){
        if (!used.has(nid)){
          picks.push({ id:nid, type:key });
          used.add(nid);
          return; // take one top item per role
        }
      }
    };

    // 1) Try primary roles for this POS (get 2-3 words depending on connector decision)
    const targetWords = shouldOfferConnector ? 2 : 3;
    for (const k of want) {
      if (picks.length >= targetWords) break;
      takeFrom(k);
    }

    // 2) Fill from any other relation lists to reach target
    if (picks.length < targetWords) {
      const all = ['syn','verb4n','obj4v','adj4n','adv4v','noun4adj','verb4adv','rhy']; ;
      for (const k of all){
        if (picks.length >= targetWords) break;
        if (want.includes(k)) continue; // already tried
        takeFrom(k);
      }
    }

    // 3) Add connector if we decided to offer one
    if (shouldOfferConnector && picks.length < 3) {
      const connectors = getConnectorsForPOS(pos);
      // Use deterministic selection based on seed
      const connectorIndex = seed % connectors.length;
      const connector = connectors[connectorIndex];
      picks.push({ id: -1, type: 'connector', connector }); // -1 means it's a connector
    }

    // 4) Guarded random fallback for remaining word slots (deterministic)
    let tries = 0;
    let fallbackSeed = seed;
    while (picks.length < 3 && tries < 300){
      const any = (fallbackSeed + tries) % data.words.length;
      if (!used.has(any)){
        picks.push({ id:any, type:'syn' });
        used.add(any);
      }
      tries++;
    }
    const result = picks.slice(0,3);
    // Cache the result
    if (useCache) {
      cachedTailId = id;
      cachedPathLength = path.length;
      cachedTailOptions = result;
    }
    return result;
  }

  // v1 path: neighbors.sem/orth/rhy
  const nbrs = data.neighbors[id];
  const lists = [
    ...nbrs.sem.map(t => ({id:t, type:'sem'})),
    ...nbrs.orth.map(t => ({id:t, type:'orth'})),
    ...nbrs.rhy.map(t => ({id:t, type:'rhy'}))
  ];

  const picks = [];
  const used = new Set([id, ...ban]);

  // Decision: sometimes offer a connector (30% chance, or if path is getting long)
  // BUT: never offer connector if current word is already a connector
  // Use a deterministic seed based on id and path length to ensure consistency
  // Use prime numbers for better distribution across different word ids
  const seed = ((id * 137) + (path.length * 97) + id) % 1000;
  const shouldOfferConnector = !currentIsConnector && ((seed / 1000) < 0.3 || path.length > 5);
  const targetWords = shouldOfferConnector ? 2 : 3;

  // Find first available (not banned) from each category
  const findFirstAvailable = (arr, type) => {
    for (const nid of arr) {
      if (!used.has(nid)) {
        picks.push({id: nid, type});
        used.add(nid);
        return true;
      }
    }
    return false;
  };

  findFirstAvailable(nbrs.sem, 'sem');
  if (picks.length < targetWords) findFirstAvailable(nbrs.orth, 'orth');
  if (picks.length < targetWords) findFirstAvailable(nbrs.rhy, 'rhy');

  // Fill remaining slots from all lists
  for (const x of lists){
    if (picks.length >= targetWords) break;
    if (!used.has(x.id)) { picks.push(x); used.add(x.id); }
  }

  // Add connector if we decided to offer one
  if (shouldOfferConnector && picks.length < 3) {
    const pos = getPOS(id) || 'NOUN';
    const connectors = getConnectorsForPOS(pos);
    // Use deterministic selection based on seed
    const connectorIndex = seed % connectors.length;
    const connector = connectors[connectorIndex];
    picks.push({ id: -1, type: 'connector', connector });
  }

  let attempts = 0;
  let fallbackSeed = seed;
  while (picks.length < 3 && attempts < 200){
    const any = (fallbackSeed + attempts) % data.words.length;
    if (!used.has(any)) { picks.push({id:any, type:'sem'}); used.add(any); }
    attempts++;
  }

  const result = picks.slice(0,3);
  // Cache the result
  if (useCache) {
    cachedTailId = id;
    cachedPathLength = path.length;
    cachedTailOptions = result;
  }
  return result;
}

// ---------- Main draw ----------
function draw(){
  background(COLORS.background[0], COLORS.background[1], COLORS.background[2]);

  // Draw currently speaking word in massive size as background
  if (currentlySpeakingWord && !isMuted) {
    push();
    fill(COLORS.backgroundWord[0], COLORS.backgroundWord[1], COLORS.backgroundWord[2]);
    noStroke();
    // Use background font
    if (backgroundFont) textFont(backgroundFont);
    
    const word = currentlySpeakingWord.toUpperCase();
    const maxWidth = width * TYPOGRAPHY.backgroundWordMaxWidthRatio;
    const fixedFontSize = height * TYPOGRAPHY.backgroundWordSizeRatio;
    
    // Start with fixed font size (for consistent height across all words)
    let fontSize = fixedFontSize;
    textSize(fontSize);
    
    // Calculate letter spacing as percentage of font size
    let letterSpacing = fontSize * TYPOGRAPHY.backgroundWordLetterSpacingRatio;
    
    // Calculate total width at fixed font size
    let totalWidth = 0;
    for (let i = 0; i < word.length; i++) {
      totalWidth += textWidth(word[i]);
      if (i < word.length - 1) totalWidth += letterSpacing;
    }
    
    // Only reduce font size if word is too wide (to maintain consistent height)
    if (totalWidth > maxWidth) {
      fontSize = (maxWidth / totalWidth) * fontSize;
      textSize(fontSize);
      letterSpacing = fontSize * TYPOGRAPHY.backgroundWordLetterSpacingRatio;
      
      // Recalculate total width with new size
      totalWidth = 0;
      for (let i = 0; i < word.length; i++) {
        totalWidth += textWidth(word[i]);
        if (i < word.length - 1) totalWidth += letterSpacing;
      }
    }
    
    textAlign(LEFT, CENTER);
    let xPos = width / 2 - totalWidth / 2;
    for (let i = 0; i < word.length; i++) {
      text(word[i], xPos, height / 2.4);
      xPos += textWidth(word[i]) + letterSpacing;
    }

    // Restore main font
    if (mainFont) textFont(mainFont);
    textAlign(CENTER, CENTER);
    pop();
  }

  // Advance expansion animation
  if (animatingWord) {
    const elapsed = millis() - animatingWord.startTime;
    animatingWord.progress = min(elapsed / animationDuration, 1);
    if (animatingWord.progress >= 1) {
      // complete the add
      // Handle connectors (stored as objects) vs words (stored as IDs)
      if (animatingWord.isConnector) {
        path.push({ type: 'connector', text: animatingWord.connectorText });
      } else {
        path.push(animatingWord.id);
        currentId = animatingWord.id;
      }
      animatingWord = null;
      // Clear cache when path changes
      cachedTailOptions = null;
      cachedTailId = null;
      cachedPathLength = -1;
    }
  }

  // Advance collapse animation
  if (collapseAnimation) {
    const elapsed = millis() - collapseAnimation.startTime;
    collapseAnimation.progress = min(elapsed / animationDuration, 1);
    if (collapseAnimation.progress >= 1) {
      path = collapseAnimation.toPath;
      currentId = getLastWordId(path); // Get last actual word, not connector
      collapseAnimation = null;
      // Clear cache when path changes
      cachedTailOptions = null;
      cachedTailId = null;
      cachedPathLength = -1;
      restartSpeech();
    }
  }

  drawTreeLikePath();

}

// ---------- Layout & rendering ----------
function drawTreeLikePath(){
  // Set main font for all words
  if (mainFont) textFont(mainFont);
  
  pathHit = [];
  optionHit = [];
  showLessHit = [];
  showMoreHit = [];

  // Layout constants
  const marginL = 60;
  const marginR = 60;
  const usableW = width - marginL - marginR;

  // Current vs target (if collapsing)
  const currentPath = collapseAnimation ? collapseAnimation.fromPath : path;
  const targetPath  = collapseAnimation ? collapseAnimation.toPath  : path;

  // Calculate line color based on path length (black to current end color transition)
  const pathLength = currentPath.length;
  const colorRatio = min(1, pathLength / LINE_COLOR_MAX_PATH_LENGTH);
  const lineColor = [
    lerp(COLORS.lineColorStart[0], currentLineColorEnd[0], colorRatio),
    lerp(COLORS.lineColorStart[1], currentLineColorEnd[1], colorRatio),
    lerp(COLORS.lineColorStart[2], currentLineColorEnd[2], colorRatio)
  ];

  const xStep      = max(120, usableW / max(3, currentPath.length + (animatingWord ? 1 : 0)));
  const targetStep = max(120, usableW / max(3, targetPath.length));
  const yBase      = height * 0.5;
  const altLen     = 120;           // branch length
  const altAngle   = radians(50);   // branch angle
  const wordBoxH   = 34;

  // Position path nodes (interpolate during collapse)
  const nodes = [];
  for (let i=0; i<currentPath.length; i++){
    let x, y;
    // Check if this node has a stored position (from being chosen as an option)
    const storedPos = nodePositions.get(i);
    if (storedPos && !collapseAnimation) {
      // Use stored position for nodes that were chosen from options
      x = storedPos.x;
      y = storedPos.y;
    } else if (collapseAnimation) {
      const eased = 1 - pow(1 - collapseAnimation.progress, 3); // ease-out
      const targetIdx = i < targetPath.length ? i : -1;
      
      if (targetIdx >= 0) {
        // Node stays in path - animate to its target position
        // Get target position (use stored if available, otherwise calculate)
        const targetStoredPos = nodePositions.get(targetIdx);
        let targetX, targetY;
        if (targetStoredPos) {
          targetX = targetStoredPos.x;
          targetY = targetStoredPos.y;
        } else {
          targetX = marginL + targetIdx * targetStep;
          targetY = yBase;
        }
        
        // Get start position (current stored position or calculated)
        const startStoredPos = nodePositions.get(i);
        let startX, startY;
        if (startStoredPos) {
          startX = startStoredPos.x;
          startY = startStoredPos.y;
        } else {
          startX = marginL + i * xStep;
          startY = yBase;
        }
        
        x = lerp(startX, targetX, eased);
        y = lerp(startY, targetY, eased);
      } else {
        // Node is being removed - animate to the previous node in sequence (cascading fold)
        const removedPos = collapseAnimation.removedNodePositions?.get(i);
        const prevNodeIdx = i - 1;
        let targetX, targetY;
        
        // Use the animated position of the previous node (already calculated in this loop)
        // This creates a cascading effect where each word folds into the next
        if (prevNodeIdx >= 0 && prevNodeIdx < nodes.length) {
          // Previous node has been calculated - use its animated position
          targetX = nodes[prevNodeIdx].x;
          targetY = nodes[prevNodeIdx].y;
        } else if (prevNodeIdx >= targetPath.length) {
          // Previous node is also being removed but not yet calculated - use its stored position
          const prevRemovedPos = collapseAnimation.removedNodePositions?.get(prevNodeIdx);
          if (prevRemovedPos) {
            targetX = prevRemovedPos.x;
            targetY = prevRemovedPos.y;
          } else {
            const prevX = marginL + prevNodeIdx * xStep;
            targetX = prevX;
            targetY = yBase;
          }
        } else {
          // Previous node stays in path - use its target position
          const prevStoredPos = nodePositions.get(prevNodeIdx);
          if (prevStoredPos) {
            targetX = prevStoredPos.x;
            targetY = prevStoredPos.y;
          } else {
            targetX = marginL + prevNodeIdx * targetStep;
            targetY = yBase;
          }
        }
        
        if (removedPos) {
          // Animate from stored position to previous node's animated position (sequential fold)
          x = lerp(removedPos.x, targetX, eased);
          y = lerp(removedPos.y, targetY, eased);
        } else {
          // Fallback: animate from calculated position to previous node
          const startX = marginL + i * xStep;
          const startY = yBase;
          x = lerp(startX, targetX, eased);
          y = lerp(startY, targetY, eased);
        }
      }
    } else {
      x = marginL + i * xStep;
      y = yBase;
    }
    nodes.push({x, y, id: currentPath[i], isRemoving: collapseAnimation && i >= targetPath.length});
  }

  // Add animating word/connector (if expanding)
  if (animatingWord && !collapseAnimation) {
    const endX = marginL + currentPath.length * xStep;
    const endY = yBase;
    animatingWord.endX = endX; // keep fresh with layout
    animatingWord.endY = endY;
    const eased = 1 - pow(1 - animatingWord.progress, 3);
    const currentX = lerp(animatingWord.startX, animatingWord.endX, eased);
    const currentY = lerp(animatingWord.startY, animatingWord.endY, eased);
    // Store connector info if it's a connector
    const animId = animatingWord.isConnector 
      ? { type: 'connector', text: animatingWord.connectorText }
      : animatingWord.id;
    nodes.push({x: currentX, y: currentY, id: animId, isAnimating: true});
  }

  // Connectors between chosen path words
  stroke(lineColor[0], lineColor[1], lineColor[2]); strokeWeight(3); noFill();
  // Calculate offset to ensure lines don't cover words but aren't too short
  textSize(TYPOGRAPHY.mainWordSize);
  for (let i=0; i<nodes.length - 1; i++){
    const a = nodes[i], b = nodes[i+1];

    // Calculate rectangle dimensions for both nodes to determine proper offset
    const labelA = isConnector(a.id) ? a.id.text : getWordText(a.id);
    const labelB = isConnector(b.id) ? b.id.text : getWordText(b.id);
    const textWidthA = textWidth(labelA);
    const textWidthB = textWidth(labelB);
    const rectWidthA = textWidthA + 12; // Rectangle width for node A
    const rectWidthB = textWidthB + 12; // Rectangle width for node B
    const rectHalfWidthA = rectWidthA / 2;
    const rectHalfWidthB = rectWidthB / 2;
    const rectHalfHeight = wordBoxH / 2;
    
    // Calculate direction vector between nodes
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = sqrt(dx * dx + dy * dy);
    
    // Calculate offset points along the direction
    let startX, startY, endX, endY;
    if (dist > 0) {
      // Determine if line is primarily horizontal or diagonal
      const isHorizontal = abs(dy) < abs(dx) * 0.3; // Mostly horizontal if vertical change is small
      
      let offsetStart, offsetEnd;
      if (isHorizontal) {
        // For horizontal lines, calculate separate offsets for each rectangle
        // Need to clear the full half-width of each rectangle plus padding
        offsetStart = rectHalfWidthA + 12; // Padding to ensure line doesn't touch rectangle
        offsetEnd = rectHalfWidthB + 12;
      } else {
        // For diagonal lines, only account for height (diagonal doesn't need full width)
        offsetStart = rectHalfHeight + 12;
        offsetEnd = rectHalfHeight + 12;
      }
      
      // Apply offsets along the direction vector
      const offsetXStart = (dx / dist) * offsetStart;
      const offsetYStart = (dy / dist) * offsetStart;
      const offsetXEnd = (dx / dist) * offsetEnd;
      const offsetYEnd = (dy / dist) * offsetEnd;
      
      startX = a.x + offsetXStart;
      startY = a.y + offsetYStart;
      endX = b.x - offsetXEnd;
      endY = b.y - offsetYEnd;
    } else {
      // Fallback for same position
      const offsetDistance = max(rectHalfWidthA, rectHalfWidthB) + 12;
      startX = a.x + offsetDistance;
      startY = a.y;
      endX = b.x - offsetDistance;
      endY = b.y;
    }

    // Fade lines for removing nodes during collapse
    if ((a.isRemoving || b.isRemoving) && collapseAnimation) {
      const opacity = 255 * (1 - collapseAnimation.progress);
      stroke(lineColor[0], lineColor[1], lineColor[2], opacity);
      line(startX, startY, endX, endY);
      stroke(lineColor[0], lineColor[1], lineColor[2]);
      continue;
    }

    // Normal line (also okay when b is animating)
    line(startX, startY, endX, endY);
  }

  // Words + branches
  textStyle(ITALIC);
  for (let i=0; i<nodes.length; i++){
    const n = nodes[i];
    const isConn = isConnector(n.id);
    const label = isConn ? n.id.text : getWordText(n.id);
    const isAnimatingNode = n.isAnimating === true;
    const isRemoving = n.isRemoving === true;

    // Fade text during collapse if removing
    let opacity = 255;
    if (isRemoving && collapseAnimation) {
      opacity = 255 * (1 - collapseAnimation.progress);
    }

    // Render the word/connector
    noStroke();
    if (isRemoving) {
      fill(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2], opacity);
    } else {
      fill(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
    }
    textSize(TYPOGRAPHY.mainWordSize);
    text(label, n.x, n.y);

    // Click region for collapsing (skip animating/removing)
    if (!isAnimatingNode && !isRemoving) {
      const tw = textWidth(label);
      const pathIdx = collapseAnimation ? (i < targetPath.length ? i : -1) : i;
      if (pathIdx >= 0) {
        const rectW = tw + 12;
        const rectH = wordBoxH;
        // Store hit region in CORNER mode coordinates
        pathHit.push({x: n.x - rectW/2, y: n.y - rectH/2, w: rectW, h: rectH, idx: pathIdx});
        noFill(); 
        stroke(COLORS.strokeGray[0], COLORS.strokeGray[1], COLORS.strokeGray[2]);
        strokeWeight(1);
        if (isRemoving && collapseAnimation) {
          stroke(COLORS.strokeGray[0], COLORS.strokeGray[1], COLORS.strokeGray[2], opacity);
        }
        // Use CENTER mode to perfectly center the rectangle on the text
        rectMode(CENTER);
        rect(n.x, n.y+2, rectW, rectH, 6);
        rectMode(CORNER); // Reset to default
        
        // Add "show less" button below the word (but not for the tail node with options)
        const pathToCheck = collapseAnimation ? collapseAnimation.toPath : path;
        const isTailNode = pathIdx === pathToCheck.length - 1;
        
        if (!isTailNode) {
          textSize(TYPOGRAPHY.buttonTextSize);
          textStyle(NORMAL);
          noStroke();
          const showLessText = "show less";
          const showLessW = textWidth(showLessText);
          const showLessY = n.y + wordBoxH/2 + 15;
          fill(COLORS.textGray[0], COLORS.textGray[1], COLORS.textGray[2], 255);
          text(showLessText, n.x, showLessY);
          textStyle(ITALIC); // Restore italic style for other text
          
          // Add clickable region for "show less"
          showLessHit.push({
            x: n.x - showLessW/2 - 4,
            y: showLessY - 8,
            w: showLessW + 8,
            h: 16,
            idx: pathIdx
          });
        }
      }
    }

    // Options appear only at the tail (unless animating from this node)
    if (isAnimatingNode || isRemoving) continue;

    const pathToCheck = collapseAnimation ? collapseAnimation.toPath : path;
    // If current node is a connector, get options from the previous word
    const nodeIdForOptions = isConn ? getLastWordId(pathToCheck.slice(0, i)) : n.id;
    
    // Only calculate options for the tail node (last item in path)
    let options = [];
    if (i === pathToCheck.length - 1 && !isAnimatingNode) {
      // This is the tail - use cached options or calculate once
      options = getThreeOptionsFor(nodeIdForOptions, true);
    } else {
      // Not the tail - don't need options
      options = [];
    }

    // Check if animating from this node (handle both word IDs and connector objects)
    const isAnimatingFromThis = animatingWord && (
      (typeof n.id === 'number' && animatingWord.fromNode === n.id) ||
      (isConn && getLastWordId(pathToCheck.slice(0, i)) === animatingWord.fromNode)
    );
    const pathIndex = collapseAnimation ? (i < pathToCheck.length ? i : -1) : i;
    const hasChosenChild = pathIndex >= 0 && ((pathIndex < pathToCheck.length - 1) || isAnimatingFromThis);

    if (hasChosenChild){
      // Past nodes show no alternates in this layout
    } else if (collapseAnimation) {
      // Don't show options during collapse animation
    } else {
      // Tail node: three branches (up-right, right, down-right)
      const dir = +1;
      const upEnd   = { x: n.x + dir * altLen * cos(altAngle), y: n.y - altLen * sin(altAngle) };
      const midEnd  = { x: n.x + dir * (altLen + 10),         y: n.y };
      const dnEnd   = { x: n.x + dir * altLen * cos(altAngle), y: n.y + altLen * sin(altAngle) };
      const ends = [upEnd, midEnd, dnEnd];

      stroke(lineColor[0], lineColor[1], lineColor[2]); strokeWeight(3);
      const picks = options;
      
      // Calculate rectangle dimensions for the tail node
      const tailLabel = isConn ? n.id.text : getWordText(n.id);
      const tailTextWidth = textWidth(tailLabel);
      const tailRectHalfWidth = (tailTextWidth + 12) / 2;
      const tailRectHalfHeight = wordBoxH / 2;

      if (isAnimatingFromThis) {
        // Only draw the connector to the in-flight animating word
        const animNode = nodes.find(node => node.isAnimating);
        if (animNode) {
          // Calculate rectangle dimensions for animating node
          const animLabel = isConnector(animNode.id) ? animNode.id.text : getWordText(animNode.id);
          const animTextWidth = textWidth(animLabel);
          const animRectHalfWidth = (animTextWidth + 12) / 2;
          const animRectHalfHeight = wordBoxH / 2;
          
          // Calculate direction vector and offset
          const dx = animNode.x - n.x;
          const dy = animNode.y - n.y;
          const dist = sqrt(dx * dx + dy * dy);
          if (dist > 0) {
            // Determine if line is primarily horizontal or diagonal
            const isHorizontal = abs(dy) < abs(dx) * 0.3;
            const offsetStart = isHorizontal 
              ? tailRectHalfWidth + 12
              : tailRectHalfHeight + 12;
            const offsetEnd = isHorizontal 
              ? animRectHalfWidth + 12
              : animRectHalfHeight + 12;
            const offsetXStart = (dx / dist) * offsetStart;
            const offsetYStart = (dy / dist) * offsetStart;
            const offsetXEnd = (dx / dist) * offsetEnd;
            const offsetYEnd = (dy / dist) * offsetEnd;
            line(n.x + offsetXStart, n.y + offsetYStart, animNode.x - offsetXEnd, animNode.y - offsetYEnd);
          }
        }
      } else {
        // Normal: show all three options
        for (let k=0; k<3; k++){
          if (picks[k]) {
            const e = ends[k];
            // Calculate rectangle dimensions for option word
            const opt = picks[k];
            const isOptConnector = opt.type === 'connector';
            const optLabel = isOptConnector ? opt.connector : data.words[opt.id];
            const optTextWidth = textWidth(optLabel);
            const optRectHalfWidth = (optTextWidth + 12) / 2;
            const optRectHalfHeight = wordBoxH / 2;
            
            // Calculate direction vector and offset
            const dx = e.x - n.x;
            const dy = e.y - n.y;
            const dist = sqrt(dx * dx + dy * dy);
            if (dist > 0) {
              // Determine if line is primarily horizontal or diagonal
              // Options are typically diagonal (up-right, right, down-right), so most will be diagonal
              const isHorizontal = abs(dy) < abs(dx) * 0.3;
              const offsetStart = isHorizontal 
                ? tailRectHalfWidth + 12
                : tailRectHalfHeight + 12;
              const offsetEnd = isHorizontal 
                ? optRectHalfWidth + 12
                : optRectHalfHeight + 12;
              const offsetXStart = (dx / dist) * offsetStart;
              const offsetYStart = (dy / dist) * offsetStart;
              const offsetXEnd = (dx / dist) * offsetEnd;
              const offsetYEnd = (dy / dist) * offsetEnd;
              line(n.x + offsetXStart, n.y + offsetYStart, e.x - offsetXEnd, e.y - offsetYEnd);
            }
          }
        }
      }

      noStroke(); textSize(TYPOGRAPHY.mainWordSize); textStyle(ITALIC);
      if (!isAnimatingFromThis) {
        for (let k=0; k<3; k++){
          const e = ends[k];
          const opt = picks[k];
          if (!opt) continue;
          
          // Handle connector vs word display
          let wordText;
          let isOptConnector = false;
          if (opt.id === -1 && opt.type === 'connector') {
            wordText = opt.connector;
            isOptConnector = true;
          } else {
            wordText = data.words[opt.id];
          }
          
          fill(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
          textSize(TYPOGRAPHY.mainWordSize);
          text(wordText, e.x, e.y);
          optionHit.push({
            x:e.x, y:e.y, r:18, opt, from:nodeIdForOptions, optionIndex: k, endPos: e,
            isConnector: isOptConnector, connectorText: isOptConnector ? opt.connector : null
          });
          
          // Add "show more" button below the option word
          textSize(TYPOGRAPHY.buttonTextSize);
          textStyle(NORMAL);
          const showMoreText = "show more";
          const showMoreW = textWidth(showMoreText);
          const showMoreY = e.y + 20;
          fill(COLORS.textGray[0], COLORS.textGray[1], COLORS.textGray[2]);
          text(showMoreText, e.x +20, showMoreY);
          textStyle(ITALIC); // Restore italic style for other text
          
          // Add clickable region for "show more"
          showMoreHit.push({
            x: e.x - showMoreW/2 - 4,
            y: showMoreY - 8,
            w: showMoreW + 8,
            h: 16,
            opt: opt,
            from: nodeIdForOptions,
            optionIndex: k,
            endPos: e,
            isConnector: isOptConnector,
            connectorText: isOptConnector ? opt.connector : null
          });
        }
      }
    }
  }

  // drawLegend();
}

// ---------- Legend (kept simple/static for v1; still fine for v2) ----------
function drawLegend(){
  // Keeping v1 labels (visual aid). You can make it dynamic later if you want.
  const items = [['Semantic','sem'],['Similar writing','orth'],['Rhyme','rhy']];
  let x = 16, y = height-22;
  textAlign(LEFT, CENTER); textSize(TYPOGRAPHY.legendTextSize); noStroke();
  for (const [label,key] of items){
    const legendColor = COLORS[key] || COLORS.textDarkGray;
    fill(legendColor[0], legendColor[1], legendColor[2]); circle(x, y, 10); x += 16;
    fill(COLORS.textDarkGray[0], COLORS.textDarkGray[1], COLORS.textDarkGray[2]); text(label, x, y);
    x += textWidth(label) + 22;
  }
  textAlign(CENTER, CENTER);
}

// ---------- Animation control ----------
function startAnimation(wordId, startX, startY, endX, endY, fromNodeId, chosenOptionIndex, isConnector = false, connectorText = null){
  // Cancel existing animations immediately by committing them
  if (animatingWord) {
    if (animatingWord.isConnector) {
      path.push({ type: 'connector', text: animatingWord.connectorText });
    } else {
      path.push(animatingWord.id);
      currentId = animatingWord.id;
    }
  }
  if (collapseAnimation) {
    path = collapseAnimation.toPath;
    currentId = getLastWordId(path);
    collapseAnimation = null;
  }

  animatingWord = {
    id: wordId,
    startX, startY,
    endX, endY,
    progress: 0,
    fromNode: fromNodeId,
    chosenOptionIndex,
    startTime: millis(),
    isConnector: isConnector,
    connectorText: connectorText
  };
  if (!isConnector) {
    currentId = wordId;
  }
}

function startCollapseAnimation(targetIdx){
  // Count actual path items (including connectors)
  const actualLength = path.length;
  if (targetIdx >= actualLength - 1) return; // nothing to do
  if (animatingWord) animatingWord = null;  // stop expansion animation

  // Store original positions of nodes that will be removed (for reverse animation)
  const removedNodePositions = new Map();
  for (let i = targetIdx + 1; i < path.length; i++) {
    if (nodePositions.has(i)) {
      removedNodePositions.set(i, nodePositions.get(i));
    }
    nodePositions.delete(i);
  }
  // Reindex remaining positions
  const newPositions = new Map();
  for (let i = 0; i <= targetIdx; i++) {
    if (nodePositions.has(i)) {
      newPositions.set(i, nodePositions.get(i));
    }
  }
  nodePositions = newPositions;

  const collapsedPath = path.slice(0, targetIdx + 1);
  const collapsedLength = collapsedPath.length;
  
  collapseAnimation = {
    fromPath: [...path],
    toPath: collapsedPath,
    startTime: millis(),
    progress: 0,
    removedNodePositions: removedNodePositions // Store positions for reverse animation
  };
  
  // Generate a new random color, then scale it proportionally to collapsed path length
  // If collapsed to first node (length 1), color should be black
  // If collapsed to middle (half of max), color should be halfway between black and the new random color
  const newRandomColor = generateRandomLineColor();
  const colorRatio = min(1, collapsedLength / LINE_COLOR_MAX_PATH_LENGTH);
  
  // If collapsed to length 1, set to black
  if (collapsedLength === 1) {
    currentLineColorEnd = [0, 0, 0];
  } else {
    // Interpolate between black and the new random color based on collapsed length
    currentLineColorEnd = [
      lerp(COLORS.lineColorStart[0], newRandomColor[0], colorRatio),
      lerp(COLORS.lineColorStart[1], newRandomColor[1], colorRatio),
      lerp(COLORS.lineColorStart[2], newRandomColor[2], colorRatio)
    ];
  }
}

// ---------- Speech ----------
function restartSpeech(resetIndex = true){
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  if (speechInterval) { clearTimeout(speechInterval); speechInterval = null; }
  currentlySpeakingWord = ''; // Clear the word when speech is cancelled
  if (resetIndex) speechIndex = 0;
  if (!isMuted) speakLoop();
}

function speakLoop(){
  if (!('speechSynthesis' in window) || isMuted) return;
  const v = pickVoice();

  if (speechInterval) clearTimeout(speechInterval);

  // Use setTimeout recursively so we can recalculate gapMs each time based on current path length
  function scheduleNext() {
    if (isMuted) {
      speechInterval = null;
      return;
    }
    
    const currentPath = [...path];
    if (currentPath.length === 0) { 
      speechIndex = 0;
      currentlySpeakingWord = ''; // Clear when path is empty
      speechInterval = setTimeout(scheduleNext, 1000); // wait a bit before retrying
      return; 
    }
    if (speechIndex >= currentPath.length) speechIndex = 0;

    const pathItem = currentPath[speechIndex];
    if (pathItem !== undefined && pathItem !== null) {
      const w = getWordText(pathItem);
      if (w) {
        const u = new SpeechSynthesisUtterance(w);
        if (v) u.voice = v;
        u.rate = 0.95; u.pitch = 1.0;
        // Show the word when speech starts
        u.onstart = () => {
          currentlySpeakingWord = w;
        };
        // Clear the word when speech ends
        u.onend = () => {
          currentlySpeakingWord = '';
        };
        // Clear the word if speech errors
        u.onerror = () => {
          currentlySpeakingWord = '';
        };
        try { speechSynthesis.speak(u); } catch(e) { 
          currentlySpeakingWord = ''; // Clear on exception too
        }
      }
    }
    speechIndex++;
    
    // Recalculate gapMs based on current path length (updates dynamically as path grows)
    const pathLength = currentPath.length;
    const maxGap = 2000; // ms - starting delay (slow)
    const minGap = 400;  // ms - minimum delay (fast)
    const reductionPerStep = 150; // ms reduced per path item
    const gapMs = max(minGap, maxGap - (pathLength - 1) * reductionPerStep);
    
    speechInterval = setTimeout(scheduleNext, gapMs);
  }
  
  scheduleNext();
}

function pickVoice(){
  if (!voices || !voices.length) voices = speechSynthesis.getVoices();
  const preferred = voices.find(v => /en/i.test(v.lang)) || voices[0];
  return preferred;
}

// ---------- Input ----------
function mousePressed(){
  // block during expansion animation
  if (animatingWord) return;

  // Click "show more" buttons on options
  for (const h of showMoreHit){
    if (mouseX >= h.x && mouseX <= h.x+h.w && mouseY >= h.y && mouseY <= h.y+h.h){
      const tailId = getLastWordId(path); // Get last actual word, not connector
      if (h.from === tailId){
        // Immediately add the chosen option to the path at its current position (no animation)
        const chosenItem = h.isConnector 
          ? { type: 'connector', text: h.connectorText }
          : h.opt.id;
        path.push(chosenItem);
        
        // Store the position where this option was chosen
        const pathKey = path.length - 1; // Index in path
        nodePositions.set(pathKey, { x: h.endPos.x, y: h.endPos.y });
        
        if (!h.isConnector) {
          currentId = h.opt.id;
        }
        // Clear cache when path changes
        cachedTailOptions = null;
        cachedTailId = null;
        cachedPathLength = -1;
      }
      return;
    }
  }

  // Click "show less" buttons on path words
  for (const h of showLessHit){
    if (mouseX >= h.x && mouseX <= h.x+h.w && mouseY >= h.y && mouseY <= h.y+h.h){
      if (animatingWord || collapseAnimation) return; // already animating
      startCollapseAnimation(h.idx);
      return;
    }
  }

  // Click tail options
  for (const h of optionHit){
    const d = dist(mouseX, mouseY, h.x, h.y);
    if (d <= h.r){
      const tailId = getLastWordId(path); // Get last actual word, not connector
      if (h.from === tailId){
        // Immediately add the chosen option to the path at its current position (no animation)
        const chosenItem = h.isConnector 
          ? { type: 'connector', text: h.connectorText }
          : h.opt.id;
        path.push(chosenItem);
        
        // Store the position where this option was chosen
        const pathKey = path.length - 1; // Index in path
        nodePositions.set(pathKey, { x: h.endPos.x, y: h.endPos.y });
        
        if (!h.isConnector) {
          currentId = h.opt.id;
        }
        // Clear cache when path changes
        cachedTailOptions = null;
        cachedTailId = null;
        cachedPathLength = -1;
      }
      return;
    }
  }

  // Click path words: collapse
  for (const h of pathHit){
    if (mouseX >= h.x && mouseX <= h.x+h.w && mouseY >= h.y && mouseY <= h.y+h.h){
      if (animatingWord || collapseAnimation) return; // already animating
      startCollapseAnimation(h.idx);
      return;
    }
  }
}

function keyPressed(){
  if (key === 'M' || key === 'm'){
    isMuted = !isMuted;
    if (isMuted) {
      speechSynthesis.cancel();
      if (speechInterval) { clearTimeout(speechInterval); speechInterval = null; }
      currentlySpeakingWord = ''; // Clear the displayed word when muted
    } else {
      restartSpeech();
    }
    return;
  }

  if (key === 'R' || key === 'r'){
    // Reset with a random first word
    if (animatingWord || collapseAnimation) {
      // Cancel any ongoing animations
      animatingWord = null;
      collapseAnimation = null;
    }
    
    // Pick a random word index
    const randomWordIndex = floor(random(data.words.length));
    currentId = randomWordIndex;
    path = [randomWordIndex];
    
    // Clear stored positions and cache
    nodePositions.clear();
    cachedTailOptions = null;
    cachedTailId = null;
    cachedPathLength = -1;
    
    // Generate a new random line color
    currentLineColorEnd = generateRandomLineColor();
    
    // Restart speech
    restartSpeech();
    return;
  }

  if (key === '1' || key === '2' || key === '3'){
    if (animatingWord) return; // ignore during animation

    const tailId = getLastWordId(path); // Get last actual word, not connector
    const opts = getThreeOptionsFor(tailId, false); // Don't use cache for keyboard input
    const i = parseInt(key) - 1;
    if (opts[i]) {
      const marginL = 60, marginR = 60;
      const usableW = width - marginL - marginR;
      const yBase = height * 0.5;
      const altLen = 120, altAngle = radians(50), dir = +1;

      // Get tail node position (use stored position if available, otherwise calculate)
      let tailNodeX, tailNodeY;
      const tailNodeIndex = path.length - 1;
      const storedTailPos = nodePositions.get(tailNodeIndex);
      if (storedTailPos) {
        tailNodeX = storedTailPos.x;
        tailNodeY = storedTailPos.y;
      } else {
        const xStep = max(120, usableW / max(3, path.length));
        tailNodeX = marginL + tailNodeIndex * xStep;
        tailNodeY = yBase;
      }

      let optionX, optionY;
      if (i === 0) {           // up-right
        optionX = tailNodeX + dir * altLen * cos(altAngle);
        optionY = tailNodeY - altLen * sin(altAngle);
      } else if (i === 1) {    // right
        optionX = tailNodeX + dir * (altLen + 10);
        optionY = tailNodeY;
      } else {                 // down-right
        optionX = tailNodeX + dir * altLen * cos(altAngle);
        optionY = tailNodeY + altLen * sin(altAngle);
      }

      // Immediately add the chosen option to the path at its calculated position (no animation)
      const opt = opts[i];
      const chosenItem = (opt.id === -1 && opt.type === 'connector')
        ? { type: 'connector', text: opt.connector }
        : opt.id;
      path.push(chosenItem);
      
      // Store the position where this option was chosen
      const pathKey = path.length - 1; // Index in path
      nodePositions.set(pathKey, { x: optionX, y: optionY });
      
      if (opt.id !== -1) {
        currentId = opt.id;
      }
      // Clear cache when path changes
      cachedTailOptions = null;
      cachedTailId = null;
      cachedPathLength = -1;
    }
  }
}
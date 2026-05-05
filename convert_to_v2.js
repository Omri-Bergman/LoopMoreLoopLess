// Convert pulse_frame_word_graph.json to v2 format
const fs = require('fs');

const inputFile = 'pulse_frame_word_graph.json';
const outputFile = 'pulse_frame_word_graph_v2.json';

console.log('Reading input file...');
const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

if (!data.lexicon || !Array.isArray(data.lexicon)) {
  console.error('Error: lexicon array not found');
  process.exit(1);
}

console.log(`Processing ${data.lexicon.length} words...`);

// Step 1: Create words array and word-to-id mapping
const words = [];
const wordToIds = new Map(); // word -> array of ids (for duplicates)
const idToWord = new Map(); // id -> word object from lexicon

data.lexicon.forEach((entry, idx) => {
  words.push(entry.w);
  if (!wordToIds.has(entry.w)) {
    wordToIds.set(entry.w, []);
  }
  wordToIds.get(entry.w).push(idx);
  idToWord.set(idx, entry);
});

// Step 2: Create POS array
// Note: This is a basic heuristic. For better accuracy, consider using a POS tagger
// or manually reviewing the POS tags after conversion.
const pos = [];
const commonVerbs = new Set(['say', 'play', 'stay', 'lay', 'way', 'day', 'gray', 'show', 'throw', 'flow', 'glow', 'slow', 'speak', 'seek', 'keep', 'sleep', 'weep', 'leap', 'sweep', 'creep', 'peep', 'trace', 'pace', 'face', 'place', 'space', 'grace', 'embrace', 'time', 'rhyme', 'chime', 'climb', 'mime', 'sound', 'found', 'bound', 'pound', 'wound', 'round', 'ground', 'feel', 'steel', 'reel', 'peel', 'heel']);
const commonAdjs = new Set(['bright', 'tight', 'white', 'right', 'sleek', 'bleak', 'unique', 'deep', 'steep', 'cheap', 'sublime', 'alone', 'low', 'bare', 'spare', 'prime']);
const commonAdvs = new Set(['brightly', 'tightly', 'rightly', 'deeply', 'steeply', 'sleekly', 'barely', 'lowly']);

words.forEach((word, idx) => {
  const wordLower = word.toLowerCase();
  
  // Check against common word lists first
  if (commonVerbs.has(wordLower)) {
    pos.push('VERB');
  } else if (commonAdjs.has(wordLower)) {
    pos.push('ADJ');
  } else if (commonAdvs.has(wordLower)) {
    pos.push('ADV');
  } else {
    // Heuristic: check for verb endings
    const verbEndings = ['ed', 'ing'];
    const isVerb = verbEndings.some(ending => wordLower.endsWith(ending));
    
    // Heuristic: check for adjective endings
    const adjEndings = ['ly'];
    const isAdj = adjEndings.some(ending => wordLower.endsWith(ending)) && !commonAdvs.has(wordLower);
    
    if (isVerb) {
      pos.push('VERB');
    } else if (isAdj) {
      pos.push('ADJ');
    } else {
      // Default to NOUN (most common)
      pos.push('NOUN');
    }
  }
});

// Step 3: Create edges object
const edges = {};

data.lexicon.forEach((entry, idx) => {
  const edgeEntry = {
    syn: [],
    rhy: [],
    verb4n: [],
    obj4v: [],
    adj4n: [],
    adv4v: [],
    noun4adj: [],
    verb4adv: []
  };

  if (entry.next && Array.isArray(entry.next)) {
    entry.next.forEach(nextItem => {
      // Find the id(s) of the next word
      const nextWord = nextItem.w;
      const nextIds = wordToIds.get(nextWord);
      
      if (nextIds && nextIds.length > 0) {
        // Use the first occurrence (or could use all)
        const nextId = nextIds[0];
        
        // Categorize based on the "why" field
        const why = nextItem.why || '';
        if (why.includes('rhyme (perfect)') || why.includes('rhyme')) {
          edgeEntry.rhy.push(nextId);
        } else if (why.includes('semantic') || why.includes('motif') || why.includes('neighbor')) {
          edgeEntry.syn.push(nextId);
        } else {
          // Default to syn if unclear
          edgeEntry.syn.push(nextId);
        }
      }
    });
  }

  // Remove empty arrays to keep JSON clean
  Object.keys(edgeEntry).forEach(key => {
    if (edgeEntry[key].length === 0) {
      delete edgeEntry[key];
    }
  });

  if (Object.keys(edgeEntry).length > 0) {
    edges[idx] = edgeEntry;
  }
});

// Step 4: Validate and create output
console.log('Validating...');

// Check for issues
const errors = [];
if (words.length !== pos.length) {
  errors.push(`words.length (${words.length}) !== pos.length (${pos.length})`);
}

// Check edge ids are valid
Object.entries(edges).forEach(([idStr, edgeObj]) => {
  const id = parseInt(idStr);
  Object.entries(edgeObj).forEach(([rel, ids]) => {
    ids.forEach(targetId => {
      if (!Number.isInteger(targetId) || targetId < 0 || targetId >= words.length) {
        errors.push(`edges[${id}].${rel} contains invalid id: ${targetId}`);
      }
    });
  });
});

if (errors.length > 0) {
  console.error('Validation errors:');
  errors.forEach(e => console.error('  -', e));
  process.exit(1);
}

// Step 5: Create output object
const output = {
  v: 2,
  words: words,
  pos: pos,
  edges: edges
};

// Optional: create index for reference (not used by app)
const index = {};
words.forEach((word, idx) => {
  if (!index.hasOwnProperty(word)) {
    index[word] = idx;
  }
});
output.index = index;

// Step 6: Write output
console.log('Writing output file...');
fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

console.log(`✓ Conversion complete!`);
console.log(`  Words: ${words.length}`);
console.log(`  POS tags: ${pos.length}`);
console.log(`  Edges: ${Object.keys(edges).length} nodes with connections`);
console.log(`  Output: ${outputFile}`);


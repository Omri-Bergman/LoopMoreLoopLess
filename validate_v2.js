// Validate v2 format JSON file
const fs = require('fs');

const filename = process.argv[2] || 'pulse_frame_word_graph_v2.json';

console.log(`Validating ${filename}...`);

const g = JSON.parse(fs.readFileSync(filename, 'utf8'));

const N = g.words?.length ?? 0;
const okPOS = new Set(['NOUN','VERB','ADJ','ADV']);
const relKeys = new Set(['syn','rhy','verb4n','obj4v','adj4n','adv4v','noun4adj','verb4adv']);

function badId(x){ return !Number.isInteger(x) || x < 0 || x >= N; }

let errors = [];
let warnings = [];

// 1) words/pos length + POS values
if (!Array.isArray(g.words) || !Array.isArray(g.pos) || g.pos.length !== N)
  errors.push(`pos must be an array of same length as words (${N}).`);

g.pos?.forEach((p,i)=>{ 
  if(!okPOS.has(p)) errors.push(`pos[${i}] = "${p}" is invalid (word: "${g.words[i]}")`); 
});

// 2) edges structure + id ranges
if (!g.edges || typeof g.edges !== 'object') {
  errors.push('edges object missing.');
} else {
  for (const [k,v] of Object.entries(g.edges)) {
    const id = parseInt(k);
    if (isNaN(id) || id < 0 || id >= N) {
      errors.push(`edge key '${k}' is not a valid numeric id (0-${N-1})`);
      continue;
    }
    if (v && typeof v === 'object') {
      for (const [rk, arr] of Object.entries(v)) {
        if (!relKeys.has(rk)) {
          warnings.push(`edges[${k}].${rk} is an unknown relation key (will be ignored)`);
          continue;
        }
        if (!Array.isArray(arr)) { 
          errors.push(`edges[${k}].${rk} is not an array`); 
          continue; 
        }
        arr.forEach((targetId,j)=>{ 
          if (badId(targetId)) {
            errors.push(`edges[${k}].${rk}[${j}] = ${targetId} is out of range (0-${N-1})`);
          }
        });
      }
    }
  }
}

// 3) Detect duplicate surface forms
const seen = new Map();
g.words.forEach((w,i)=>{
  const list = seen.get(w) || [];
  list.push(i);
  seen.set(w, list);
});
for (const [w,ids] of seen.entries()) {
  if (ids.length > 1) {
    warnings.push(`duplicate token "${w}" at ids ${ids.join(', ')}`);
  }
}

// 4) Check for nodes with no edges
let nodesWithEdges = new Set(Object.keys(g.edges || {}).map(k => parseInt(k)));
let nodesWithoutEdges = [];
for (let i = 0; i < N; i++) {
  if (!nodesWithEdges.has(i)) {
    nodesWithoutEdges.push(i);
  }
}
if (nodesWithoutEdges.length > 0) {
  warnings.push(`${nodesWithoutEdges.length} nodes have no edges: ${nodesWithoutEdges.slice(0, 10).join(', ')}${nodesWithoutEdges.length > 10 ? '...' : ''}`);
}

if (errors.length) { 
  console.error('\n❌ ERRORS:');
  errors.forEach(e => console.error('  -', e)); 
  process.exit(1); 
}

if (warnings.length) {
  console.warn('\n⚠️  WARNINGS:');
  warnings.forEach(w => console.warn('  -', w));
}

console.log('\n✅ Validation passed!');
console.log(`   Words: ${N}`);
console.log(`   POS tags: ${g.pos?.length || 0}`);
console.log(`   Nodes with edges: ${Object.keys(g.edges || {}).length}`);
console.log(`   Total edge relations: ${Object.values(g.edges || {}).reduce((sum, e) => sum + Object.values(e).reduce((s, arr) => s + arr.length, 0), 0)}`);


// Development tools resolve their inputs both in the shared handoff and in the
// integrated project. Nothing in the mini-program runtime imports this module.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const resources = path.join(root, 'docs', '项目资料');
const localKnowledge = path.join(resources, '知识库', '古渊头村AI讲解知识库.docx');
const integrated = fs.existsSync(localKnowledge);
const handoff = integrated ? path.join(resources, 'Claude_Guide_Handoff') : path.dirname(root);
module.exports = {
  handoff,
  baseline: path.join(handoff, 'source'),
  knowledge: integrated ? localKnowledge : path.join(handoff, 'knowledge', 'village-knowledge.docx'),
  env: path.join(handoff, 'api-config', '.env.local'),
  deliverables: path.join(handoff, 'deliverables')
};

const { processUploadedConversation } = require('../src/uploadAgent');
const db = require('../src/database');
const fs = require('fs');

async function run() {
  await db.initDb();
  const subjects = db.listSubjects();
  if (subjects.length === 0) {
    console.log('No subjects found');
    process.exit(1);
  }
  const subjectId = subjects[0].id;
  
  const text = fs.readFileSync('scratch/whitepaper.txt', 'utf-8');
  console.log('Ingesting blueprint...');
  try {
    const res = await processUploadedConversation(subjectId, text);
    console.log('Blueprint ingested successfully.');
    console.log('Summary:', res.summary);
  } catch (e) {
    console.error('Error ingesting blueprint:', e);
  }
  process.exit(0);
}

run();

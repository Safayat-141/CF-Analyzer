/**
 * Module to get Codeforces handles from user input
 * Saves handles to a file and validates them
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const HANDLES_FILE = 'codeforces_handles.txt';

/**
 * Gets Codeforces handles from command line arguments
 * @returns {string[]} Array of Codeforces handles
 */
function getHandlesFromCLI() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Error: No Codeforces handles provided');
    console.log('Usage: node getHandle.js <handle1> [handle2] [handle3] ...');
    process.exit(1);
  }
  
  return args;
}

/**
 * Gets Codeforces handles from user input (interactive mode)
 */
async function getHandlesFromInput() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question('Enter Codeforces handles (comma-separated): ', (answer) => {
      rl.close();
      
      const handles = answer
        .split(',')
        .map(handle => handle.trim())
        .filter(handle => handle.length > 0);
      
      if (handles.length === 0) {
        console.error('Error: No valid handles provided');
        process.exit(1);
      }
      
      resolve(handles);
    });
  });
}

/**
 * Validates Codeforces handles format
 * @param {string[]} handles - Array of Codeforces handles
 * @returns {object} Object containing valid and invalid handles
 */
function validateHandles(handles) {
  const validHandlePattern = /^[a-zA-Z0-9_-]+$/;
  const valid = [];
  const invalid = [];
  
  handles.forEach(handle => {
    if (validHandlePattern.test(handle) && handle.length > 0) {
      valid.push(handle);
    } else {
      invalid.push(handle);
    }
  });
  
  return { valid, invalid };
}

/**
 * Saves handles to file (appends new handles, avoids duplicates)
 * @param {string[]} handles - Array of Codeforces handles
 * @returns {object} Object with saved handles and duplicates
 */
function saveHandlesToFile(handles) {
  try {
    let existingHandles = [];
    let duplicates = [];
    let newHandles = [];

    // Read existing handles if file exists
    if (fs.existsSync(HANDLES_FILE)) {
      const fileContent = fs.readFileSync(HANDLES_FILE, 'utf-8');
      existingHandles = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    }

    // Check for duplicates and new handles
    handles.forEach(handle => {
      if (existingHandles.includes(handle)) {
        duplicates.push(handle);
      } else {
        newHandles.push(handle);
      }
    });

    // Append new handles to file with timestamp
    if (newHandles.length > 0) {
      const timestamp = new Date().toISOString();
      const content = newHandles.map(h => `${h} (Added: ${timestamp})`).join('\n') + '\n';
      
      fs.appendFileSync(HANDLES_FILE, content, 'utf-8');
    }

    return { newHandles, duplicates, total: existingHandles.length + newHandles.length };
  } catch (error) {
    console.error('Error saving handles to file:', error.message);
    process.exit(1);
  }
}

/**
 * Reads all saved handles from file
 * @returns {string[]} Array of saved handles
 */
function readHandlesFromFile() {
  try {
    if (!fs.existsSync(HANDLES_FILE)) {
      return [];
    }

    const fileContent = fs.readFileSync(HANDLES_FILE, 'utf-8');
    return fileContent
      .split('\n')
      .map(line => {
        // Extract handle (before the "Added:" part if it exists)
        const handleMatch = line.match(/^([a-zA-Z0-9_-]+)/);
        return handleMatch ? handleMatch[1] : null;
      })
      .filter(handle => handle !== null);
  } catch (error) {
    console.error('Error reading handles from file:', error.message);
    return [];
  }
}

/**
 * Process handles: validate, save, and return results
 * @param {string[]} handles - Array of Codeforces handles
 * @returns {object} Processing results with valid handles and status
 */
async function processHandles(handles) {
  console.log('\n--- Processing Codeforces Handles ---\n');

  // Validate handles
  const { valid, invalid } = validateHandles(handles);
  
  if (invalid.length > 0) {
    console.warn(`⚠️  Invalid handles detected: ${invalid.join(', ')}`);
  }

  if (valid.length === 0) {
    console.error('❌ No valid handles to process');
    process.exit(1);
  }

  console.log(`✓ Valid handles: ${valid.join(', ')}`);

  // Save handles to file
  const saveResult = saveHandlesToFile(valid);
  
  console.log(`\n📝 File Operations:`);
  console.log(`   - New handles added: ${saveResult.newHandles.length}`);
  console.log(`   - Duplicates skipped: ${saveResult.duplicates.length}`);
  console.log(`   - Total handles in file: ${saveResult.total}`);
  console.log(`   - File location: ${HANDLES_FILE}`);

  if (saveResult.newHandles.length > 0) {
    console.log(`   - Saved: ${saveResult.newHandles.join(', ')}`);
  }

  if (saveResult.duplicates.length > 0) {
    console.log(`   - Duplicates: ${saveResult.duplicates.join(', ')}`);
  }

  console.log('\n✅ Handles processed and saved successfully!\n');

  return {
    validHandles: valid,
    invalidHandles: invalid,
    savedHandles: saveResult.newHandles,
    duplicateHandles: saveResult.duplicates,
    totalInFile: saveResult.total
  };
}

/**
 * Display all saved handles
 */
function displaySavedHandles() {
  const handles = readHandlesFromFile();
  
  if (handles.length === 0) {
    console.log('No handles saved yet.');
    return;
  }

  console.log('\n--- Saved Codeforces Handles ---\n');
  handles.forEach((handle, index) => {
    console.log(`${index + 1}. ${handle}`);
  });
  console.log(`\nTotal: ${handles.length} handles\n`);
}

module.exports = {
  getHandlesFromCLI,
  getHandlesFromInput,
  validateHandles,
  saveHandlesToFile,
  readHandlesFromFile,
  processHandles,
  displaySavedHandles,
  HANDLES_FILE
};

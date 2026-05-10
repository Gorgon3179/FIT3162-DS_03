console.log('testing express...');
try {
  const express = require('express');
  console.log('SUCCESS: express loaded');
} catch(e) {
  console.log('ERROR:', e.message);
}

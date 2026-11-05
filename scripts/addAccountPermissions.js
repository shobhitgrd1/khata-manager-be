require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/khata_manager');
  const newPerms = ['view_accounts', 'create_account', 'edit_account', 'delete_account'];
  const users = await User.find({});
  for (const u of users) {
    let changed = false;
    for (const p of newPerms) {
      if (!u.permissions.includes(p)) {
        u.permissions.push(p);
        changed = true;
      }
    }
    if (changed) await u.save();
    console.log(`Updated ${u.username}: ${u.permissions.join(', ')}`);
  }
  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(console.error);

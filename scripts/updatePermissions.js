require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const updatePermissions = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/khata_manager';
    await mongoose.connect(mongoUri);
    console.log('[UpdatePermissions] Connected to MongoDB');

    const ccPermissions = [
      'view_credit_cards',
      'create_credit_card',
      'edit_credit_card',
      'delete_credit_card',
    ];

    const users = await User.find({});
    for (const u of users) {
      const perms = new Set([...(u.permissions || []), ...ccPermissions]);
      if (u.role === 'admin') {
        perms.add('user');
        perms.add('view_user');
        perms.add('create_user');
        perms.add('edit_user');
        perms.add('delete_user');
      }
      perms.add('dashboard');
      u.permissions = Array.from(perms);
      await u.save({ validateBeforeSave: false });
      console.log(`[UpdatePermissions] Updated user ${u.username} (${u.role}) permissions:`, u.permissions);
    }

    console.log('[UpdatePermissions] Done!');
    process.exit(0);
  } catch (err) {
    console.error('[UpdatePermissions] Error:', err);
    process.exit(1);
  }
};

updatePermissions();


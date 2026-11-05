require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const seedAdmin = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/khata_manager';
    await mongoose.connect(mongoUri);
    console.log('[Seed] Connected to MongoDB');

    const adminEmail = 'admin@khatamanager.com';
    const existingAdmin = await User.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log(`[Seed] Administrator account (${adminEmail}) already exists.`);
      // Ensure it has all permissions
      existingAdmin.role = 'admin';
      existingAdmin.permissions = [
        'dashboard',
        'user',
        'create_user',
        'edit_user',
        'delete_user',
        'view_user',
      ];
      await existingAdmin.save();
      console.log('[Seed] Admin permissions refreshed successfully.');
    } else {
      const newAdmin = new User({
        name: 'System Administrator',
        email: adminEmail,
        username: 'admin',
        password: 'Admin@123456',
        dateOfBirth: new Date('1990-01-01'),
        role: 'admin',
        permissions: [
          'dashboard',
          'user',
          'create_user',
          'edit_user',
          'delete_user',
          'view_user',
        ],
        status: 'active',
      });

      await newAdmin.save();
      console.log('[Seed] Default Administrator account created successfully:');
      console.log('       Email:    admin@khatamanager.com');
      console.log('       Username: admin');
      console.log('       Password: Admin@123456');
    }

    // Also let's create a sample regular user if doesn't exist for test purposes
    const regularEmail = 'user@khatamanager.com';
    const existingUser = await User.findOne({ email: regularEmail });
    if (!existingUser) {
      const regularUser = new User({
        name: 'John Demo User',
        email: regularEmail,
        username: 'johnuser',
        password: 'User@123456',
        dateOfBirth: new Date('1995-05-15'),
        role: 'user',
        permissions: ['dashboard'],
        status: 'active',
      });
      await regularUser.save();
      console.log('[Seed] Sample regular user created successfully:');
      console.log('       Email:    user@khatamanager.com');
      console.log('       Username: johnuser');
      console.log('       Password: User@123456');
    }

    process.exit(0);
  } catch (error) {
    console.error('[Seed] Error seeding admin account:', error.message);
    process.exit(1);
  }
};

seedAdmin();


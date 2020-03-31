const User = require("../models/User");
const bcrypt = require("bcrypt");

const createUser = async ({ username, password }) => {
  const user = await User.findOne({ username });
  if (user) {
    // User exists
    const error = new Error("user exists");
    throw error;
  }

  // TODO: Make salt rounds a config option
  const hashedPassword = await bcrypt.hash(password, 10);

  /**
   * ROLES:
   * 0 - User
   * 1 - Mod
   * 2 - Admin
   *
   * ACCOUNT STATUSES:
   * 0 - Normal
   * 1 - Muted (Cannot send messages, can view chat)
   * 2 - Banned (Cannot Enter Chat)
   */

  const newUser = new User({
    username,
    password: hashedPassword,
    role: 0,
    blockedUsers: [],
    blockedBy: [],
    accountStatus: 0
  });
  newUser.save();
  return newUser;
};

const addUserToBlockList = async (blockingUserId, blockedUserId) => {
  const blockingUser = await User.findById(blockingUserId);
  if (!blockingUser.blockedUsers.includes(blockedUserId)) {
    const blockedUser = await User.findById(blockedUserId);
    blockingUser.blockedUsers.push(blockedUserId);
    blockedUser.blockedBy.push(blockingUserId);
    await blockingUser.save();
    await blockedUser.save();

    return {
      blocked: blockingUser.blockedUsers,
      blockedBy: blockedUser.blockedBy
    };
  } else {
    return {
      blocked: blockingUser.blockedUsers,
      blockedBy: blockedUser.blockedBy
    };
  }
};
const removeUserFromBlockList = async (unblockingUserId, unblockedUserId) => {
  const unblockingUser = await User.findById(unblockingUserId);
  if (unblockingUser.blockedUsers.includes(unblockedUserId)) {
    const unblockedUser = await User.findById(unblockedUserId);
    unblockingUser.blockedUsers.splice(
      unblockingUser.blockedUsers.indexOf(unblockedUserId),
      1
    );
    unblockedUser.blockedBy.splice(
      unblockedUser.blockedBy.indexOf(unblockingUserId),
      1
    );
    await unblockingUser.save();
    await unblockedUser.save();
    return {
      blocked: unblockingUser.blockedUsers,
      blockedBy: unblockedUser.blockedBy
    };
  } else {
    console.log("user not in blocklist");
    return {
      blocked: unblockingUser.blockedUsers,
      blockedBy: unblockedUser.blockedBy
    };
  }
};
const readUser = async ({ username }) => {
  const user = await User.findOne({ username });
  if (!user) {
    const error = new Error("Cannot find that user");
    throw error;
  }

  return user;
};

const banUser = async userId => {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error("Cannot find that user");
    throw error;
  }

  user.accountStatus = 2;
  await user.save();
  return user;
};

const updatePassword = async (user, password) => {
  console.log(user);
  const hashedPassword = await bcrypt.hash(password, 10);
  user.password = hashedPassword;
  await user.save();
};

const setAccountStatus = async (userId, status) => {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error("Cannot find that user");
    throw error;
  }

  user.accountStatus = status;
  await user.save();
  return user;
};

const getBannedUsers = async () => {
  const users = await User.find({ accountStatus: 2 }).select("id username");
  return users;
};
module.exports = {
  createUser,
  readUser,
  addUserToBlockList,
  removeUserFromBlockList,
  banUser,
  setAccountStatus,
  getBannedUsers,
  updatePassword
};

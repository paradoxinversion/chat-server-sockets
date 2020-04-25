const userActions = require("../mongo/actions/User");

/**
 * Sends a chat message to the room or a private room
 * and adds it to chat history
 * @param {*} io
 * @param {*} socket
 * @param {*} data
 * @param {*} chatHistory
 */
const sendChatMessage = function (io, socket, data, chatHistory) {
  if (socket.client.user.accountStatus > 0) {
    return; // user is banned, don't bother
  }
  let message;
  if (data.isServerMessage) {
    message = {
      id: "system",
      time: Date.now(),
      message: data.message,
    };
  } else {
    message = {
      id: socket.id,
      user: socket.client.user,
      message: data.message,
      time: Date.now(),
      from: data.from || "",
      fromUID: data.fromUID || "",
      to: data.to || "",
      toUID: data.toUID || "",
    };
  }

  if (data.to) {
    socket.to(data.to).emit("pm", message);
    socket.emit("pm", message);
  } else {
    io.emit("chat-message-broadcast", message);
    const historyEntry = {
      ...message,
    };

    if (historyEntry.id !== "system") {
      historyEntry.user = {
        userId: message.user.userId,
        username: message.user.username,
        profilePhotoURL: message.user.profilePhotoURL,
      };
    }
    if (chatHistory.length > 100) {
      chatHistory.shift();
    }
    chatHistory.push(historyEntry);
  }
};

const banUser = async function (io, userSocketId, getClientBySocketId) {
  // Get the user's db id
  const userIID = getClientBySocketId(userSocketId).user.iid;

  // ban the user in the db
  const banResult = await userActions.setAccountStatus(userIID, 2);

  // emit the ban to the room (to remove from their user lists)
  io.emit("ban-user", { bannedUser: banResult.username });

  // emit the ban to the banned user
  io.sockets.sockets[userSocketId].emit("account-status-change", {
    accountStatus: 2,
  });
  // Disconnect the user
  io.sockets.sockets[userSocketId].disconnect(true);
};

/**
 * Emits a list of users that are banned
 * @param {*} socket
 */
const getBannedUsers = async function (socket) {
  const bannedUsers = await userActions.getBannedUsers();
  socket.emit("get-banned-users", { users: bannedUsers });
};

const changeAccountStatus = async function (io, userId, status) {
  const statusStrings = {
    "0": "Normal",
    "1": "Muted",
    "2": "Banned",
  };
  const statusChange = await userActions.setAccountStatus(userId, status);
  io.emit("change-user-account-status", {
    user: statusChange.username,
    status: statusStrings[status],
  });

  //! add a check here... user will likely not be online esp if they're baned
  io.sockets.sockets[userSocketId].emit("targeted-user-notice", {
    message: "Your account status has been set to " + statusStrings[status],
  });
};

const blockUser = async function (io, socket, userId, getClientByUserId) {
  const blockResult = await userActions.addUserToBlockList(
    socket.client.user.userId,
    userId
  );

  socket.emit("block-user", {
    blocklist: blockResult.blocked,
  });

  const blockedUserClient = getClientByUserId(userId);
  io.sockets.sockets[getClientByUserId(userId).id].emit("block-user", {
    blockedBy: blockResult.blockedBy,
  });
};

const unblockUser = async function (io, socket, userId, getClientByUserId) {
  try {
    const unblockResult = await userActions.removeUserFromBlockList(
      socket.client.user.userId,
      userId
    );
    // debugger;
    socket.emit("unblock-user", { blocklist: unblockResult.blocked });
    if (getClientByUserId(userId)) {
      io.sockets.sockets[getClientByUserId(userId).id].emit("unblock-user", {
        blockedBy: unblockResult.blockedBy,
      });
    }
  } catch (e) {
    throw e;
  }
};

/**
 * Initiates a private chat between two users, by setting up a named
 * room cosisting of both user's socketids, joined with a dash (-)
 * @param {*} io
 * @param {*} socket
 * @param {*} userId
 */
const initatePrivateChat = function (io, socket, userId) {
  const [p1, p2] = [socket.id, userId].sort((a, b) => a - b);
  const roomName = `${p1}-${p2}`;
  Promise.all([
    socket.join(roomName),
    io.sockets.sockets[userId].join(roomName),
  ]);

  io.to(roomName).emit("private-chat-initiated", roomName);
};

const setUsername = async function (io, socket, username, user, getChatUsers) {
  const existingUser = getUserByName(username);
  if (!existingUser) {
    const clientUser = await User.findById(user);
    const oldName = socket.client.user.username;
    socket.client.user.username = username;
    await userActions.updateUsername(clientUser, username);
    io.emit("room-user-change", {
      users: getChatUsers(),
      message: `${oldName} is now ${socket.client.user.username}.`,
      user: socket.client.user,
    });
  } else {
    socket.emit("set-username-error", "Username Taken");
  }
};

const setUserPhoto = async function (
  io,
  socket,
  userId,
  photoURL,
  getChatUsers
) {
  const user = await User.findById(userId);
  if (user) {
    await userActions.setUserPhoto(user, photoURL);
    socket.client.user.profilePhotoURL = photoURL;
    io.emit("room-user-update", {
      users: getChatUsers(),
    });
  }
};

const disconnect = function (io, socket, removeChatClient, getChatUsers) {
  console.log("Socket disconnected");
  removeChatClient(socket.id);
  io.emit("user-disconnected", { username: socket.client.user });
  io.emit("room-user-change", {
    users: getChatUsers(),
    message: `${socket.client.user.username} has left the chat room.`,
    user: socket.client.user,
  });
};
module.exports = {
  sendChatMessage,
  getBannedUsers,
  banUser,
  changeAccountStatus,
  blockUser,
  unblockUser,
  initatePrivateChat,
  setUsername,
  setUserPhoto,
  disconnect,
};

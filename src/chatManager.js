const socketActions = require("./sockets/socketActions");

const ChatManager = function (io) {
  this.chatClients = [];
  this.chatHistory = [];
  this.io = io;

  /**
   * Adds a chat client to the `chatClients` array if one doesn't
   * already exist.
   * @param {*} client - A socket client
   */
  this.addChatClient = (client, user) => {
    let clientExists = false;
    for (let x = 0; x < this.chatClients.length; x++) {
      const chatClient = this.chatClients[x];
      if (chatClient.id === client.id) client = true;
    }

    // If none exists yet, add it
    if (!clientExists) {
      client.user = socketActions.createUser(client.id, user);

      this.chatClients.push(client);
    }
    return client;
  };

  this.removeChatClient = (clientId) => {
    this.chatClients = this.chatClients.filter(
      (client) => client.id !== clientId
    );
    return this.chatClients;
  };

  /**
   * Return an array of chat users (from the clients array)
   */
  this.getChatUsers = () => this.chatClients.map((client) => client.user);

  this.getClientBySocketId = (socketId) => {
    return this.chatClients.find((client) => {
      return client.id === socketId;
    });
  };

  this.getClientByUserId = (userId) => {
    return this.chatClients.find((client) => client.user.userId === userId);
  };
};

module.exports = ChatManager;

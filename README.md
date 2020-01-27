# Chat Server

This is a server for a simple chat room, using socketio.

## Development

Install dependencies via `npm` or `yarn`.

### Scripts

#### start:dev

Starts the server in development mode

#### start:debug

Starts the server in debug mode. For more info on inspecting node server scripts as they execute, see the [node docs](https://nodejs.org/de/docs/guides/debugging-getting-started/)

## Socket Events

Below are events used by socketio, along with which interface is used. If `socket`, it should only affect the user connected to that socket. If `io`, it should affect all connected sockets.

### on-events

`connection` (io): Add a new chat client

`chat-message-sent` (socket): A chat message has been sent from the client and recieved by the server. Create a message object with the data recieved and emit `chat-message-broadcast`

`private-chat-initiated` (socket): Adds the socket and the socket matching the supplied ID to a new room for private messaging via `socket.join`.

`set-username` (socket): Changes the socket client's username

`disconnect` (socket): Remove the socket's chat client from the list. (Do I actually _need_ the list?)

### emit-events

`user-connected` (socket): Return a user object for the socket

`room-user-change` (io): Emits when a user is connected or disconnected. Sends back a list of chat users (by mapping the stored clients) and an announcement of which user entered/left.

`private-chat-initiated` (socket): Sends the name of the private chat room (pm space) to the users in that room.

`pm` (socket): Used to emit private messages between users.

`chat-message-broadcast` (io): Used to emit public/general room messages with all connected sockets.

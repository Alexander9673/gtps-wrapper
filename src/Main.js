const { EventEmitter } = require('events');
const { readFileSync, readdirSync, statSync } = require('fs');
const WorldItem = require('./structs/WorldItem');
const WorldInfo = require('./structs/WorldInfo');
const PlayerMoving = require('./structs/PlayerMoving');
let netID = 0;

/**
 * The Main Class is the file that you would require to handle everything.
 * @extends EventEmitter The class responsible for handling events.
 * @prop {Object} options Options for the server.
 * @prop {Number} options.port The port to use for the growtopia server.
 * @prop {Number} options.channels The amount of channels to use.
 * @prop {Number} options.peers The amount of peers to use.
 * @prop {Object} options.bandwith Options for the bandwith.
 * @prop {Number} options.bandwith.incoming The max amount of incoming bandwith.
 * @prop {Number} options.bandwith.outgoing The max amount of outgoing bandwith.
 * @prop {String} options.location The location of the items.dat file.
 * @prop {String} options.cdn The cdn content to use.
 */

class Main extends EventEmitter {
  #gtps;
  #os = process.platform;
  #isInitialized;
  #version;
  #loadCommands = function() {
    let files = readdirSync(this.commandsDir)
    .filter(file => statSync(`${this.commandsDir}/${file}`).isFile() && file.endsWith('.js'));

    for (let i = 0; i < files.length; i++) {
      let file = require(`${this.commandsDir}/${files[i]}`);
      this.commands.set(file.name, file);

      console.log(`Loaded ${file.name} command`);
    }
  }

  constructor(options = {}) {
    super(options);
    this.#gtps = require(`../packages/${this.#os}/${process.version.slice(1).split('.')[0]}/gtps.node`);
    this.#version = this.#gtps.version;

    Object.defineProperties(this, {
      port: {
        value: options.port || 17091
      },

      channels: {
        value: options.channels || 32
      },

      peers: {
        value: options.peers || 2
      },

      bandwith: {
        value: options.bandwith || {
          incoming: 0,
          outgoing: 0
        }
      },

      itemsDatHash: {
        value: this.getHash(options.location || 'items.dat')
      },

      itemsDat: {
        value: this.buildItemsDatabase(options.location || 'items.dat')
      },

      cdn: {
        value: options.cdn || "0098/CDNContent61/cache/"
      },

      commandsDir: {
        value: options.commandsDir || `${__dirname}/commands`
      },

      worlds: {
        value: new Map()
      },

      players: {
        value: new Map()
      },

      commands: {
        value: new Map()
      },

      spawn: {
        value: {
          x: 1605,
          y: 1150
        }
      }
    });

    this.netID = netID;
    this.#loadCommands();
  }

  /**
   * Returns the current version of node-gtps you're running.
   * @readonly
   */

  get version() {
    return this.#version;
  }

  /**
   * Returns the value of the private variable "isInitialized"
   * @readonly
   */

  get isInitialized() {
    return this.#isInitialized;
  }

  /**
   * A modifier to the private variable "isInitialized". This does not initialize enet.
   * @returns {undefined}
   */

  init() {
    this.#isInitialized = true;
  }

  /**
   * Returns the value of the private variable "gtps" which is the compiled c++ addon
   * @returns {Object}
   */

  getModule() {
    return this.#gtps;
  }

  /**
   * Gets the message type from the ArrayBuffer provided by the server.
   * @param {ArrayBuffer} packet The packet you received.
   * @returns {Number} 
   */

  GetPacketType(packet) {
    return Buffer.from(packet).readUInt32LE();
  }

  /**
   * Decodes the packet if it was encoded with raw text.
   * @param {ArrayBuffer} packet The packet you received.
   * @returns {String}
   */

  GetMessage(packet) {
    return Buffer.from(packet).toString('utf-8', 4);
  }

  /**
   * Creates a packet.
   * @param {String} asdf The header of the packet
   * @param {Number} size The size to allocate for the buffer/packet. 
   * @returns {Object}
   */

  createPacket(asdf, size) {
    if (!asdf)
      asdf = "0400000001000000FFFFFFFF00000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

    if (!size)
      size = 61;

    const p = {};

    let buffer = Buffer.alloc(size);

    for (let i = 0; i < asdf.length; i += 2) {
      let x = parseInt(asdf[i], 16);
      x = x << 4;
      x += parseInt(asdf[i + 1], 16);

      buffer[i / 2] = x;
    }

    p.data = buffer;
    p.len = size;
    p.indexes = 0;

    return p;
  }

  /**
   * Appends a String to the packet
   * @param {Object} packet Packet data
   * @param {String} str The string to append
   * @returns {Object} Packet data
   */

  appendString(packet, str) {
    let p = {}

    let index = Buffer.alloc(1);
    index.writeIntLE(packet.indexes, 0, 1);
    let strLen = Buffer.alloc(4);
    strLen.writeIntLE(str.length, 0, 4);

    let buffers = Buffer.concat([
      packet.data,
      index,
      Buffer.from([0x02]),
      strLen,
      Buffer.from(str)
    ]);

    packet.indexes++;

    p.data = buffers;
    p.len = p.data.length;
    p.indexes = packet.indexes;
    return p;
  }

  /**
   * Appends an Number to the packet
   * @param {Object} packet Packet Data
   * @param {Number} val The value/number to add
   * @returns {Object} Packet data
   */

  appendInt(packet, val) {
    let p = {}

    let index = Buffer.alloc(1);
    index.writeIntLE(packet.indexes, 0, 1);
    let v = Buffer.alloc(4);
    v.writeIntLE(val, 0, 4);

    let buffers = Buffer.concat([
      packet.data,
      index,
      Buffer.from([0x09]),
      v
    ]);

    packet.indexes++;

    p.data = buffers;
    p.len = p.data.length;
    p.indexes = packet.indexes;
    return p;
  }

  /**
   * Same as appendInt, but this uses the byte value of 0x05 after the index
   * @param {Object} packet The packet to append to
   * @param {Number} val The value to append.
   * @returns {Object} packet data.
   */

  appendIntx(packet, val) {
    let p = {}	
  
    let index = Buffer.alloc(1);
    index.writeIntLE(packet.indexes, 0, 1);
    let v = Buffer.alloc(4);
    v.writeInt32LE(val);
  
    let buffers = Buffer.concat([
      packet.data,
      index,
      Buffer.from([0x05]),
      v
    ]);
  
    packet.indexes++;
  
    p.data = buffers;
    p.len = p.data.length;
    p.indexes = packet.indexes;
    return p;
  }

  /**
   * Adds the last thing to end a packet and to be able to have the correct format.
   * @param {Object} packet The packet you created or used append with.
   * @returns {Object} Packet data
   */

  packetEnd(packet) {
    let p = {};
    let n = Buffer.alloc(packet.len + 1);
    
    for (let i = 0; i < packet.len; i++) {
      n[i] = packet.data[i];
    }
  
    let zero = 0;
    n.writeIntLE(zero, n.length - 1, 1);
  
    n.writeIntLE(packet.indexes, 56, 1);
    n.writeIntLE(packet.indexes, 60, 1);
  
    p.data = n;
    p.len = n.length;
    p.indexes = packet.indexes;
  
    return p;
  }

  /**
   * Gets the hash of the items.dat
   * @param {String} location The location of the items.dat file.
   * @returns {Number}
   */

  getHash(location) {
    let h = 0x55555555;
    let file;

    try {
      file = readFileSync(location);
    } catch (e) {
      throw new Error("Can't open items.dat, maybe it's not there?");
    }

    for (let i = 0; i < file.length; i++) {
      h = (h >>> 27) + (h << 5);
    }

    return h;
  }

  /**
   * Builds the item database
   * @param {String} location The location of the items.dat file.
   * @returns {Buffer}
   */

  buildItemsDatabase(location) {
    let file;

    try {
      file = readFileSync(location);
    } catch (e) {
      throw new Error("Can't open items.dat, maybe it's not there?");
    }

    let buf = this.createPacket("0400000010000000FFFFFFFF000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 60 + file.length);

    buf.data.writeIntLE(file.length, 56, 4);
    for (let i = 0; i < file.length; i++) {
      buf.data[60 + i] = file[i];
    }

    return buf.data;
  }

  /**
   * Sends a world to load
   * @param {String} peerid The id of the peer joining 
   * @param {Object} world The world to send
   * @returns {undefined}
   */

  sendWorld(peerid, world) {
    let name = world.name.toUpperCase();
    let x = world.width;
    let y = world.height;
    let square = x * y;
    let nameLen = name.length;
  
    let total = 78 + nameLen + square + 24 + (square * 8);
    let data = Buffer.alloc(total);
  
    data.writeIntLE(4, 0, 1);
    data.writeIntLE(4, 4, 1);
    data.writeIntLE(8, 16, 1);
    data.writeIntLE(-1, 8, 4);
    data.writeIntLE(nameLen, 66, 1);
    data.write(name, 68, nameLen);
    data.writeIntLE(x, 68 + nameLen, 1);
    data.writeIntLE(y, 72 + nameLen, 1);
    data.writeIntLE(square, 76 + nameLen, 2);
  
    let mempos = 80 + nameLen;
  
    for (let i = 0; i < square; i++) {
      data.writeIntLE(world.items[i].foreground, mempos, 2);
      data.writeIntLE(world.items[i].background, mempos + 2, 2);
      data.writeIntLE(0, mempos + 4, 4);
  
      mempos += 8;
      if (world.items[i].foreground === 6 || i === 3650) {
        data.writeIntLE(0x01, mempos, 1)
        data.writeIntLE(0x04, mempos + 1, 1);
        data.writeIntLE(0x00, mempos + 2, 1);
        data.writeIntLE(0x45, mempos + 3, 1);
        data.writeIntLE(0x58, mempos + 4, 1);
        data.writeIntLE(0X49, mempos + 5, 1);
        data.writeIntLE(0x54, mempos + 6, 1);
        data.writeIntLE(0x00, mempos + 7, 1);
        mempos += 8;
      }
    }

    

    for (let i = 0; i < square; i++) {
      let data = {};
      data.packetType = 0x3;
  
      data.characterState = 0x0;
      data.x = i%world.width;
      data.y = i/world.height;
      data.punchX = i%world.width;
      data.punchY = i / world.width;
      data.ySpeed = 0;
      data.xSpeed = 0;
      data.netID = -1;
      data.plantingTree = world.items[i].foreground;
  
      this.#gtps.Packets.sendPacketRaw(peerid, 4, this.packPlayerMoving(data), 56, 0);
    }
  
    this.worlds.set(name, { data, len: total, ...world });
  
    this.#gtps.Packets.sendPacket(peerid, data, total);
  }

  /**
   * Generates a world.
   * @param {String} name Name of the world to generate
   * @param {Number} width The width of the world
   * @param {Number} height The height of the world
   * @returns {Object} World data generated
   */

  generateWorld(name, width, height) {
    let world = new WorldInfo();
    world.name = name;
    world.width = width;
    world.height = height;
  
    for (let i = 0; i < world.width*world.height; i++)
    {
      world.items[i] = new WorldItem();
  
      if (i >= 3800 && i < 5400 && !(Math.floor(Math.random() * 50))) { world.items[i].foreground = 10; }
      else if (i >= 3700 && i < 5400) {
        if (i > 5000) {
          if (i % 7 == 0) { world.items[i].foreground = 4;}
          else { world.items[i].foreground = 2; }
        }
        else { world.items[i].foreground = 2; }
      }
      else if (i >= 5400) { world.items[i].foreground = 8; }
      if (i >= 3700)
        world.items[i].background = 14;
      if (i === 3650)
        world.items[i].foreground = 6;
      else if (i >= 3600 && i<3700)
        world.items[i].foreground = 0;
      if (i == 3750)
        world.items[i].foreground = 8;
    }
  
    return world;
  }

  /**
   * Checks if two peers are in the same world
   * @param {String} peerid The peer to compare
   * @param {String} peerid2 The peer to compare with
   * @returns {Boolean} If they are in the same world.
   */

  isInSameWorld(peerid, peerid2) {
    let player = this.players.get(peerid);
    let player2 = this.players.get(peerid2);

    return (player.currentWorld === player2.currentWorld) && (player.currentWorld !== "EXIT" && player2.currentWorld !== "EXIT");
  }

  /**
   * Sends an onSpawn to a specific peer
   * @param {String} peer The peer to send data to.
   * @param {String} msg The packet to send
   * @return {undefined}
   */

  onSpawn(peer, msg) {
    let packet = this.packetEnd(this.appendString(this.appendString(this.createPacket(), "OnSpawn"), msg));
    return this.#gtps.Packets.sendPacket(peer, packet.data, packet.len);
  }

  /**
   * Sends an onSpawn to every other peer in the same world as the given peer
   * @param {String} peerid Peer that joined
   * @returns {undefined}
   */

  onPeerConnect(peerid) {
    let peers = [...this.players.keys()];

    for (let i = 0; i < this.players.size; i++) {
      if (this.isInSameWorld(peerid, peers[i])) {
        if (peerid !== peers[i]) {
          let playerInfo = this.players.get(peers[i]);
          this.onSpawn(peerid, `spawn|avatar\nnetID|${playerInfo.netID}\nuserID|${playerInfo.netID}\ncolrect|0|0|20|30\nposXY|${playerInfo.x}|${playerInfo.y}\nname|\`\`${playerInfo.displayName}\`\`\ncountry|${playerInfo.country}\ninvis|0\nmstate|0\nsmstate|0\n`);
        
          playerInfo = this.players.get(peerid);
          this.onSpawn(peers[i], `spawn|avatar\nnetID|${playerInfo.netID}\nuserID|${playerInfo.netID}\ncolrect|0|0|20|30\nposXY|${playerInfo.x}|${playerInfo.y}\nname|\`\`${playerInfo.displayName}\`\`\ncountry|${playerInfo.country}\ninvis|0\nmstate|0\nsmstate|0\n`)
        };
      }
    }
  }

  /**
   * Makes a player leave the world
   * @param {String} peerid The id of the peer that left
   * @returns {undefined}
   */

  sendPlayerLeave(peerid) {
    let player = this.players.get(peerid);

    if (player) {
      let world = this.worlds.get(player.currentWorld);
      if (world) {   
        world.players = world.players.filter(p => p.netID !== player.netID);
        this.worlds.set(world.name, world);
      }

      let p = this.packetEnd(
        this.appendString(
          this.appendString(
            this.createPacket(),
            "OnRemove"),
          `netID|${player.netID}\n`));

      let p2 = this.packetEnd(
        this.appendString(
          this.appendString(
            this.createPacket(),
            "OnConsoleMessage"),
          `Player: \`w${player.displayName}\`o left.`));
  
      let peers = [...this.players.keys()];
  
      for (let i = 0; i < peers.length; i++) {
        if (this.isInSameWorld(peerid, peers[i])) {
          {
            this.#gtps.Packets.sendPacket(peerid, p.data, p.len);
            this.#gtps.Packets.sendPacket(peers[i], p.data, p.len);
          }
          {
            this.#gtps.Packets.sendPacket(peers[i], p2.data, p2.len);
          }
        }
      }

      player.currentWorld = "EXIT";
      this.players.set(peerid, player);
    }
  }
  
  /**
   * Gets the Struct Pointer from the packet
   * @param {ArrayBuffer} packet Packet from message type 4
   * @returns {Number}
   */

  GetStructPointerFromTankPacket(packet) {
    let p = Buffer.from(packet);
    let len = p.length;
  
    let result = Buffer.alloc(len);
  
    if (len >= 0x3C) {
      let packetData = p;
      result = packetData[4];
    }
  
    return result;
  }

  /**
   * Sends player data to the server
   * @param {String} peerid The id of the peer
   * @param {Object} data The data to send
   * @returns {undefined}
   */

  sendPData(peerid, data) {
    let peers = [...this.players.keys()];
  
    for (let i = 0; i < peers.length; i++) {
      if (this.isInSameWorld(peerid, peers[i])) {
        if (peerid !== peers[i]) {
          data.netID = this.players.get(peerid).netID;
          this.#gtps.Packets.sendPacketRaw(peers[i], 4, this.packPlayerMoving(data), 56, 0);
        }
      }
    }
  };

  /**
   * Creates a buffer that would contain PlayerMoving data
   * @param {Object} data PlayerMoving data to add to the buffer
   * @returns {Buffer} The buffer that has those data
   */

  packPlayerMoving(data) {
    let packet = Buffer.alloc(56);
    let offsets = {
      packetType: 0,
      netID: 4,
      characterState: 12,
      plantingTree: 20,
      x: 24,
      y: 28,
      xSpeed: 32,
      ySpeed: 36,
      punchX: 44,
      punchY: 48
    };
  
    for (let packetOffset of Object.keys(offsets)) {
      if (packetOffset === 'x' || packetOffset === 'y' || packetOffset === 'xSpeed' || packetOffset === 'ySpeed') {
        packet.writeFloatLE(data[packetOffset], offsets[packetOffset], 4);
      } else {
        packet.writeIntLE(data[packetOffset], offsets[packetOffset], 4);
      }
    }
  
    return packet;
  }

  /**
   * Unpacks a PlayerMoving data and convert it to an object
   * @param {ArrayBuffer} data Data received from message type 4
   * @returns {Object} The unpacked PlayerMoving data.
   */

  unpackPlayerMoving(data) {
    let packet = Buffer.from(data);
    let dataStruct = new PlayerMoving();
    let offsets = {
      packetType: 0,
      netID: 4,
      characterState: 12,
      plantingTree: 20,
      x: 24,
      y: 28,
      xSpeed: 32,
      ySpeed: 36,
      punchX: 44,
      punchY: 48
    };
  
    for (let packetOffset of Object.keys(offsets)) {
      if (packetOffset === 'x' || packetOffset === 'y' || packetOffset === 'xSpeed' || packetOffset === 'ySpeed') {
        dataStruct[packetOffset] = packet.readFloatLE(offsets[packetOffset] + 4, 4);
      } else {
        dataStruct[packetOffset] = packet.readIntLE(offsets[packetOffset] + 4, 4);
      }
    }
  
    return dataStruct;
  }
};

// DOCS PURPOSES
/**
 * Connect Event
 * 
 * @event Main#connect
 * @property {String} peerid The id of the peer that connected
 */

/**
 * Receive Event
 * Emitted when you receive data
 * 
 * @event Main#receive
 * @property {Map} packet A map of received packets from the client.
 * @property {String} peerid The id of the peer that send that packet.
 */

/**
 * Disconnect Event
 * Emitted when a player leaves the game/disconnect
 * @property {String} peerid The id of the peer that disconnected.
 */

module.exports = Main;
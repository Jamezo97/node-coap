const dgram           = require('dgram')
    , util            = require('util')
    , events          = require('events')
    , parse           = require('coap-packet').parse
    , generate        = require('coap-packet').generate
    , IncomingMessage = require('./incoming_message')
    , ServerResponse  = require('./server_response')
    , LRU             = require('lru-cache')
    , parameters      = require('./parameters')
    , coapPort        = 5683

function CoAPServer(options) {
  if (!(this instanceof CoAPServer)) {
    return new CoAPServer(options)
  }

  if (!options)
    options = {}

  var that = this
  this._sock = dgram.createSocket('udp4', function(msg, rsinfo) {
    try {
      that._handle(msg, rsinfo)
    } catch(err) {
      that.emit('error', err)
    }
  })

  // We use an LRU cache for the responses to avoid
  // DDOS problems.
  // max packet size is 1280
  // 32 MB / 1280 = 26214
  // The max lifetime is roughly 200s per packet.
  // Which gave us 131 packets/second guarantee
  this._lru = LRU({
      max: options.cacheSize || (32768 * 1024)
    , length: function(n) { return n.length }
    , maxAge: parameters.exchangeLifetime
  })
}

util.inherits(CoAPServer, events.EventEmitter)

CoAPServer.prototype.listen = function(port, address, done) {
  if (typeof address === 'function') {
    done = address
    address = null
  }

  this._sock.bind(port, address, done)
  this._port = port
  this._address = address

  return this
}

CoAPServer.prototype.close = function(done) {
  this._sock.close()
  if (done) {
    done()
  }

  return this
}

CoAPServer.prototype._handle = function(msg, rsinfo) {
  var packet    = parse(msg)
    , key       = rsinfo.address + rsinfo.port + 
                  packet.token.toString('hex') + packet.messageId

    , lru       = this._lru
    , cached    = lru.peek(key)
    , sock      = this._sock
    , request
    , response
    , send

  send = function(message) {
    if (!cached)
      lru.set(key, message)

    sock.send(message, 0, message.length,
              rsinfo.port, rsinfo.address, function(err) {
      if (err && response)
        response.emit('error', err)
    })
  }

  if (cached)
    return send(cached)


  request = new IncomingMessage(packet)
  response = new ServerResponse(packet, send)

  this.emit('request', request, response)
}

module.exports = CoAPServer
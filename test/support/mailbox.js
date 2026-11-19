// A real SMTP listener for tests: nodemailer talks SMTP to it, it keeps each
// message. `refuse = true` refuses recipients, as a mail server would.
var net = require('node:net');

function startMailbox() {
  var box = { messages: [], refuse: false, server: null };
  return new Promise(function(resolve) {
    box.server = net.createServer(function(sock) {
      var data = null;
      var buffer = '';
      sock.write('220 test ESMTP\r\n');
      sock.on('data', function(chunk) {
        buffer += chunk.toString('utf8');
        var i;
        while ((i = buffer.indexOf('\r\n')) !== -1) {
          var line = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          if (data !== null) {
            if (line === '.') { box.messages.push(data.join('\n')); data = null; sock.write('250 queued\r\n'); }
            else data.push(line.charAt(0) === '.' ? line.slice(1) : line);
            continue;
          }
          var verb = line.slice(0, 4).toUpperCase();
          if (verb === 'EHLO' || verb === 'HELO') sock.write('250 test\r\n');
          else if (verb === 'MAIL') sock.write('250 ok\r\n');
          else if (verb === 'RCPT') sock.write(box.refuse ? '550 mailbox unavailable\r\n' : '250 ok\r\n');
          else if (verb === 'DATA') { data = []; sock.write('354 go ahead\r\n'); }
          else if (verb === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('250 ok\r\n');
        }
      });
    });
    box.server.listen(0, '127.0.0.1', function() {
      box.port = box.server.address().port;
      resolve(box);
    });
  });
}

// Mail bodies are quoted-printable; undo it to read them back.
function decodeQP(s) {
  return String(s || '').replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, function(m, h) { return String.fromCharCode(parseInt(h, 16)); });
}

module.exports = { startMailbox: startMailbox, decodeQP: decodeQP };

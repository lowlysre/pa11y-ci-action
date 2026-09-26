const {spawn} = require('node:child_process');
const net = require('node:net');

if (process.argv[2] === 'child') {
	const server = net.createServer(socket => {
		socket.on('data', () => {
			socket.end();
			server.close();
		});
	});
	server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port: server.address().port})));
} else {
	spawn(process.execPath, [__filename, 'child'], {stdio: 'inherit'});
}

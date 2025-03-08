module.exports = {
    execute: async (message, args, client) => {
        const startTime = Date.now();
        await client.sendMessage(message.from, 'Pong!');
        const endTime = Date.now();
        const latency = endTime - startTime;
        return `Latência: ${latency}ms 🏓`;
    }
};
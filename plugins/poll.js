module.exports = {
    execute: async (message, args, client) => {
        if (args.length < 3) {
            return "Use: !poll <pergunta> <opção1> <opção2> [tempo em minutos]";
        }
        const question = args[0];
        const options = args.slice(1, args.length - 1);
        const time = parseInt(args[args.length - 1]) || 5; // Padrão: 5 minutos
        if (!message.to.includes('@g.us')) {
            return "Este comando só funciona em grupos!";
        }

        const pollMessage = `📊 Enquete: ${question}\n` +
                            options.map((opt, i) => `${i + 1}. ${opt}`).join('\n') +
                            `\nResponda com o número da opção em até ${time} minutos!`;
        await client.sendMessage(message.to, pollMessage);

        const votes = new Map();
        const collector = setTimeout(async () => {
            let result = `Resultado da enquete: ${question}\n`;
            options.forEach((opt, i) => {
                const count = votes.get(i + 1) || 0;
                result += `${i + 1}. ${opt}: ${count} votos\n`;
            });
            await client.sendMessage(message.to, result);
        }, time * 60 * 1000);

        client.on('message', (msg) => {
            if (msg.to === message.to && !isNaN(msg.body) && parseInt(msg.body) <= options.length && parseInt(msg.body) > 0) {
                votes.set(parseInt(msg.body), (votes.get(parseInt(msg.body)) || 0) + 1);
            }
        }, { once: false, timeout: time * 60 * 1000 });

        return "Enquete criada! Responda com o número da sua escolha.";
    }
};
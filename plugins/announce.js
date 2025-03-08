const config = require('../config.json'); // Ajuste o caminho conforme necessário

module.exports = {
    execute: async (message, args, client) => {
        if (message.from !== config.adminNumber) {
            return "Somente o administrador pode usar este comando!";
        }
        if (args.length === 0) {
            return "Digite uma mensagem para anunciar! Exemplo: !announce Olá a todos";
        }
        const announcement = args.join(' ');
        try {
            for (const groupId of config.monitoredGroups) {
                await client.sendMessage(groupId, `📢 Anúncio: ${announcement}`);
            }
            return "Anúncio enviado para todos os grupos com sucesso!";
        } catch (error) {
            return "Erro ao enviar o anúncio. Tente novamente.";
        }
    }
};
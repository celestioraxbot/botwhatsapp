const logger = require('../utils/logger');

// Cache para relatórios
const cache = {};

async function execute(message) {
    try {
        // Verifica se a mensagem foi enviada em um grupo
        if (!message.isGroupMsg) {
            await message.reply('Este comando só pode ser usado em grupos.');
            return;
        }

        // Obtém o ID do grupo e a data atual
        const groupId = message.from;
        const date = new Date().toISOString().split('T')[0]; // Data no formato YYYY-MM-DD

        // Verifica se o relatório já está em cache
        if (cache[`${groupId}-${date}`]) {
            await message.reply(cache[`${groupId}-${date}`]);
            return;
        }

        // Recupera as mensagens do grupo para a data atual
        const messages = require('../index').getGroupMessages(groupId, date);

        if (!messages || messages.length === 0) {
            await message.reply('Nenhuma mensagem foi registrada no grupo hoje.');
            return;
        }

        // Gera o ranking de mensagens
        const messageCounts = {};
        messages.forEach((msg) => {
            const sender = msg.sender.id; // ID do remetente
            if (!messageCounts[sender]) {
                messageCounts[sender] = 0;
            }
            messageCounts[sender]++;
        });

        // Ordena os remetentes pelo número de mensagens
        const sortedSenders = Object.entries(messageCounts)
            .sort((a, b) => b[1] - a[1]) // Ordena em ordem decrescente
            .map(([sender, count]) => ({ sender, count }));

        // Formata o ranking com medalhas
        const topSenders = sortedSenders.slice(0, 3); // Top 3
        const remainingSenders = sortedSenders.slice(3); // Demais participantes

        let ranking = '🏆 *Ranking de Mensagens* 🏆\n\n';

        // Adiciona medalhas para os três primeiros colocados
        topSenders.forEach((sender, index) => {
            const medal = ['🥇', '🥈', '🥉'][index];
            ranking += `${medal} ${sender.sender.split('@')[0]}: ${sender.count} mensagens\n`;
        });

        // Adiciona os demais participantes, se houver
        if (remainingSenders.length > 0) {
            ranking += '\nOutros participantes:\n';
            remainingSenders.forEach((sender) => {
                ranking += `• ${sender.sender.split('@')[0]}: ${sender.count} mensagens\n`;
            });
        }

        // Formata o relatório geral
        const report = `
📊 *Relatório de Mensagens do Grupo - ${date}* 📊
Total de mensagens: ${messages.length}
Mensagens registradas (mostrando as 10 mais recentes):
${messages.slice(0, 10).map((msg, index) => `${index + 1}. ${msg.body}`).join('\n')}
${ranking}
        `;

        // Salva o relatório no cache
        cache[`${groupId}-${date}`] = report;

        // Envia o relatório completo
        await message.reply(report);
    } catch (error) {
        logger.error('Erro ao gerar relatório de grupo:', error.message);
        await message.reply('Desculpe, ocorreu um erro ao gerar o relatório do grupo. Por favor, tente novamente mais tarde.');
    }
}

module.exports = { execute };
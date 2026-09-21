/**
 * feed.js — Journal de bord et messagerie entre les deux directions.
 *
 * Le journal est déjà filtré par le serveur : une alerte « rupture matière »
 * n'apparaît que chez la Direction Industrielle. Les lignes marquées « share »
 * sont, elles, volontairement publiées dans les deux journaux — c'est le
 * canal par lequel un joueur transmet un chiffre exact à l'autre.
 */
import { esc } from './dom.js';

const MAX_ENTRIES = 160;

export function createFeed(refs) {
  let unread = 0;
  let activeTab = 'log';

  const scrollDown = (pane) => { pane.scrollTop = pane.scrollHeight; };

  for (const tab of refs.tabs) {
    tab.addEventListener('click', () => {
      activeTab = tab.dataset.tab;
      refs.tabs.forEach((t) => t.classList.toggle('selected', t === tab));
      refs.logPane.hidden = activeTab !== 'log';
      refs.chatPane.hidden = activeTab !== 'chat';
      refs.chatForm.hidden = activeTab !== 'chat';
      if (activeTab === 'chat') {
        unread = 0;
        refs.badge.hidden = true;
        scrollDown(refs.chatPane);
      } else scrollDown(refs.logPane);
    });
  }

  return {
    addLog(entries) {
      if (!entries?.length) return;
      const atBottom = refs.logPane.scrollHeight - refs.logPane.scrollTop - refs.logPane.clientHeight < 40;
      for (const e of entries) {
        const node = document.createElement('div');
        node.className = `entry ${e.kind}`;
        node.innerHTML = `<span class="entry-day">J${e.day}</span><span class="entry-text">${esc(e.text)}</span>`;
        refs.logPane.appendChild(node);
      }
      while (refs.logPane.childElementCount > MAX_ENTRIES) refs.logPane.firstElementChild.remove();
      if (atBottom) scrollDown(refs.logPane);
    },

    addChat(msg, myRole) {
      const node = document.createElement('div');
      node.className = `msg ${msg.from}`;
      const who = msg.from === myRole ? 'Vous' : esc(msg.name ?? '');
      node.innerHTML = `<span class="who">${who}</span> <span class="txt">${esc(msg.text)}</span>`;
      refs.chatPane.appendChild(node);
      while (refs.chatPane.childElementCount > MAX_ENTRIES) refs.chatPane.firstElementChild.remove();
      scrollDown(refs.chatPane);

      if (activeTab !== 'chat' && msg.from !== myRole) {
        unread += 1;
        refs.badge.hidden = false;
        refs.badge.textContent = String(unread);
      }
    },

    clear() { refs.logPane.innerHTML = ''; refs.chatPane.innerHTML = ''; },
  };
}

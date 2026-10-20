/**
 * 局内全屏菜单:左边一列导航,右边换页。游戏画面还在后面,只是模糊压暗。
 * 竖屏时导航变成顶部一排能横着滑的标签(见 vn.css)。
 *
 * 这里只管壳子,每页画什么由外面传进来。
 */

import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { AnimaLogo } from './AnimaLogo';
import { MAIN_SITE_LOVE_URL } from '../lib/studioConfig';

export type MenuPage = 'log' | 'save' | 'card' | 'plugin' | 'preset' | 'model' | 'config' | 'dev';

const MENU_PAGES: { key: MenuPage; name: string }[] = [
  { key: 'log', name: '历史' },
  { key: 'save', name: '存档' },
  { key: 'card', name: '角色' },
  { key: 'plugin', name: '插件' },
  { key: 'preset', name: '预设' },
  { key: 'model', name: '模型' },
  { key: 'config', name: '设置' },
];

const PAGE_NAME: Record<MenuPage, string> = {
  log: '历史',
  save: '存档',
  card: '角色',
  plugin: '插件',
  preset: '预设',
  model: '模型',
  config: '设置',
  dev: '开发者',
};

/** 玩家界面(创作者模式关)只留这三页:看历史、读存档、调设置。
 *  角色 / 插件 / 预设 / 模型都是创作工具,调试台里才有。 */
const PLAYER_PAGES = new Set<MenuPage>(['log', 'save', 'config']);

interface Props {
  page: MenuPage;
  onPage: (page: MenuPage) => void;
  /** 导航顶上:角色名 + 当前对话名 */
  charName: string;
  chatName: string;
  /** 页头右侧的额外控件(比如历史页的「显示原文」) */
  headExtra?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  onTitle: () => void;
  /** 「素材」:打开素材管理页(全屏,盖在菜单上面,不是菜单里的一页);不给就没有这一项 */
  onLibrary?: () => void;
  /** 创作者模式:关掉时只留玩家页(历史 / 存档 / 设置),不出「开发者」和创作工具页。默认开 */
  creator?: boolean;
}

export function VNMenu({ page, onPage, charName, chatName, headExtra, children, onClose, onTitle, onLibrary, creator = true }: Props) {
  // 窄屏时导航是一排横滑的标签,当前页可能在屏幕外 —— 换页时把它滚进来
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current
      ?.querySelector('.vn-nav.on')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [page]);

  const pages = creator ? MENU_PAGES : MENU_PAGES.filter((p) => PLAYER_PAGES.has(p.key));

  return (
    <div className="vn-menu" role="dialog" aria-label="菜单">
      <nav className="vn-menu-nav" ref={navRef}>
        <div className="vn-menu-brand">
          <AnimaLogo size={32} />
          <div>
            <strong>{charName || '还没选角色'}</strong>
            <span>{chatName}</span>
          </div>
        </div>
        {pages.map((p) => (
          <Fragment key={p.key}>
            <button
              className={`vn-nav${page === p.key ? ' on' : ''}`}
              aria-current={page === p.key ? 'page' : undefined}
              onClick={() => onPage(p.key)}
            >
              {p.name}
            </button>
            {p.key === 'plugin' && creator && onLibrary && (
              <button className="vn-nav" title="素材管理:库里所有的立绘、声音、背景、BGM、CG(全屏打开)" onClick={onLibrary}>
                素材
              </button>
            )}
          </Fragment>
        ))}
        <div className="vn-nav-gap" />
        {creator && (
          <button
            className={`vn-nav minor${page === 'dev' ? ' on' : ''}`}
            onClick={() => onPage('dev')}
          >
            开发者
          </button>
        )}
        <button className="vn-nav minor" onClick={onTitle}>
          返回标题
        </button>
        {/* 回链主站:Studio 是本地伴生运行时,玩完要能回到恋爱域继续(玩家可见,不受创作者模式影响)。
            story 结束页与故事包带回是后续批次的事,这里先给一条稳定的回路。 */}
        <a
          className="vn-nav minor"
          href={MAIN_SITE_LOVE_URL}
          title="回到 SocialCoach 恋爱页"
        >
          回到 SocialCoach
        </a>
        <button className="vn-nav back" onClick={onClose}>
          返回游戏 <kbd>Esc</kbd>
        </button>
      </nav>

      <section className={`vn-menu-page page-${page}`}>
        <header className="vn-menu-head">
          <h2>{PAGE_NAME[page]}</h2>
          {headExtra}
        </header>
        <div className="vn-menu-body">{children}</div>
      </section>
    </div>
  );
}

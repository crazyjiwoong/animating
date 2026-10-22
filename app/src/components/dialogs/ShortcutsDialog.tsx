import { Keyboard } from 'lucide-react';
import { Modal } from '../ui';

const LIST: [string, string][] = [
  ['브러시 / 지우개 / 도형', 'B / E / U'],
  ['이동·변형 / 카메라 / 채우기', 'V / C / G'],
  ['스포이드 / 손', 'I / H'],
  ['임시 손 도구', 'Space 누른 채 드래그'],
  ['임시 스포이드', 'Alt 누른 채 클릭'],
  ['브러시 크기', '[ / ]'],
  ['재생 / 정지', 'Enter'],
  ['이전 / 다음 프레임', ', / . 또는 ← / →'],
  ['처음 / 끝 프레임', 'Home / End'],
  ['프레임 복제', 'Ctrl + D'],
  ['새 프레임', 'Ctrl + Shift + F'],
  ['새 레이어', 'Ctrl + Shift + N'],
  ['올가미 선택 도구', 'L'],
  ['클리핑 켜기/끄기', 'Ctrl + Alt + G'],
  ['미세 이동 (이동 도구)', '방향키 · Shift = 10px'],
  ['범위 지정 (이동 도구)', '꾹 누른 채로 끌기'],
  ['범위 확정 / 취소 / 지우기', 'Enter / Esc / Delete'],
  ['셀 복사 / 붙여넣기', 'Ctrl + C / V'],
  ['이미지 붙여넣기', 'Ctrl + V (클립보드 이미지)'],
  ['셀 지우기', 'Delete'],
  ['실행 취소 / 다시 실행', 'Ctrl + Z / Ctrl + Shift + Z'],
  ['저장', 'Ctrl + S'],
  ['내보내기', 'Ctrl + E'],
  ['이전 프레임 겹쳐 보기', 'O'],
  ['화면 맞춤 / 확대 / 축소', '0 / + / -'],
  ['프레임 설정', '프레임 두 번 누르기'],
  ['그림 길이 조절', '타임라인 막대 끝 끌기 · 우클릭 메뉴'],
  ['격자 / 좌우 반전 보기', "' / M"],
  ['화면 회전', 'R 누른 채 드래그 (Shift = 15°)'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal wide icon={<Keyboard size={18} />} title="단축키" sub="Mac 은 Ctrl 대신 ⌘" onClose={onClose}>
      <div className="shortcut-list">
        {LIST.map(([a, b]) => (
          <div key={a}>
            <span>{a}</span>
            <span className="kbd">{b}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

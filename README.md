# NeoPawn Helper

Расширение Visual Studio Code для NeoPawn Compiler и классического Pawn. Оно индексирует проект без отдельного языкового сервера, понимает новый ООП-синтаксис и продолжает работать с обычными `.pwn`, `.inc` и `.module`.

## Преимущества

- Полная подсветка `class`, `extends`, `abstract`, `final`, `virtual`, `override`, `owned`, модификаторов доступа, свойств и полей только для чтения.
- Переход к объявлению класса, базового класса, конструктора нужной арности, поля, свойства, метода и унаследованного члена.
- Переход из `base(...)` к конструктору родителя.
- Поддержка `this.member`, `object.Member()`, `Class.Member`, `Class.Is(...)`, `Class.Cast(...)` и старого `THIS__`.
- Подсказки членов после точки и классов после `new` с учётом наследования.
- Hover с сигнатурой члена и указанием класса, от которого он унаследован.
- Индекс функций, глобальных переменных, `#define`, `enum`, диалогов, `global`/`foreign` и пространств имён `Namespace::Function`.
- Переходы по `#include` и ссылки между MySQL-запросами и callback-функциями.
- Подсветка цветов, SQL и спецификаторов `mysql_format`.
- Диагностика количества аргументов `mysql_format`.
- Встроенные значения простых `#define`, `const` и элементов `enum`.
- Совместная работа NeoPawn и старого Pawn в одном проекте.

## Поддерживаемый ООП-синтаксис

```pawn
abstract class Entity[128] {
	protected int id;
	public property float Angle;
	public readonly int Model;
	public static int Count;

	Entity(int id, int model)
	{
		this.id = id;
		this.Model = model;
		Entity.Count++;
	}

	abstract int GetValue();

	~Entity()
	{
	}
}

final class Player extends Entity {
	Player(int id, int model)
	{
		base(id, model);
	}

	override int GetValue()
	{
		return this.id;
	}
}

stock System_Use()
{
	owned Player player = new Player(10, 411);
	Entity entity = Entity:player;

	if (Player.Is(entity))
	{
		Player checked = Player.Cast(entity);
		checked.GetValue();
	}
}
```

Поддерживаются оба варианта наследования: `class Player extends Entity` и `class Player : Entity`. Перегруженные конструкторы, деструкторы, статические члены, `public/protected/private`, `property`, `readonly`, `virtual/override`, абстрактные и финальные классы индексируются как самостоятельные символы.

Старый стиль также распознаётся:

```pawn
#define this. THIS__(Entity)

Float:Entity_GetAngle(Entity:this__)
{
	return this.GetAngle();
}

#undef this
```

## Команды

Откройте палитру команд через `Ctrl+Shift+P`:

- `NeoPawn Helper: переиндексировать проект` — полностью перестроить индекс;
- `NeoPawn Helper: создать enum из CREATE TABLE` — преобразовать выделенный SQL `CREATE TABLE` в Pawn enum.

## Настройки

| Параметр | Назначение | По умолчанию |
|---|---|---:|
| `neoPawnHelper.colors.enabled` | Подсветка цветовых литералов и именованных цветов | `true` |
| `neoPawnHelper.colors.variables.enabled` | Отдельная подсветка обращений к именованным цветам | `true` |
| `neoPawnHelper.constants.valueHints.enabled` | Встроенные значения числовых констант | `true` |
| `neoPawnHelper.definitions.enabled` | Переходы к определениям и поиск ссылок | `true` |
| `neoPawnHelper.sql.highlighting.enabled` | Подсветка SQL внутри строк | `true` |
| `neoPawnHelper.sql.diagnostics.enabled` | Проверка аргументов `mysql_format` | `true` |
| `neoPawnHelper.index.include` | Glob-шаблоны индексируемых файлов | `**/*.{pwn,inc,module}` |
| `neoPawnHelper.index.exclude` | Glob-шаблоны исключений | служебные каталоги |
| `neoPawnHelper.index.maxFiles` | Максимальное число файлов в индексе | `20000` |
| `neoPawnHelper.index.debounceMs` | Задержка полной переиндексации | `1200` мс |
| `neoPawnHelper.index.documentDebounceMs` | Задержка обновления открытого файла | `250` мс |

Пример `settings.json`:

```json
{
  "neoPawnHelper.index.include": [
    "gamemodes/**/*.{pwn,inc,module}",
    "API/**/*.{pwn,inc,module}"
  ],
  "neoPawnHelper.index.exclude": [
    "**/.git/**",
    "**/build/**"
  ],
  "neoPawnHelper.sql.diagnostics.enabled": true
}
```

## Установка VSIX

1. Откройте раздел расширений VS Code.
2. Выберите меню `…` → `Установить из VSIX…`.
3. Укажите `neopawn-helper-1.0.1.vsix`.
4. Перезагрузите окно редактора.

## Разработка

```powershell
npm test
npm run check
npm run package
```

`npm test` проверяет разбор классов, наследования, модификаторов, конструкторов, деструкторов, `owned` и совместимого Pawn-синтаксиса.

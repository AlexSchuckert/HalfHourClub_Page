<?php
declare(strict_types=1);
/*
 * Contributions are markdown written by anyone with the family password.
 * Raw HTML in them is escaped into visible text and javascript:/data: links are
 * dropped, so a contribution can't run code in anyone's browser. The strict
 * Content-Security-Policy in bootstrap.php is a second wall behind that.
 */

use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\Autolink\AutolinkExtension;
use League\CommonMark\Extension\CommonMark\CommonMarkCoreExtension;
use League\CommonMark\Extension\SmartPunct\SmartPunctExtension;
use League\CommonMark\MarkdownConverter;

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v'];

function markdown_converter(): MarkdownConverter {
    static $converter;
    if (!$converter) {
        $environment = new Environment([
            'html_input' => 'escape',
            'allow_unsafe_links' => false,
            // A single newline is a line break: poems depend on it.
            'renderer' => ['soft_break' => "<br />\n"],
        ]);
        $environment->addExtension(new CommonMarkCoreExtension());
        $environment->addExtension(new AutolinkExtension());
        $environment->addExtension(new SmartPunctExtension()); // curly quotes and proper dashes
        $converter = new MarkdownConverter($environment);
    }
    return $converter;
}

/**
 * Markdown → safe HTML, with `media/<name>` references pointing at the private
 * media route. Markdown has no video syntax, so a clip is written as an image —
 * ![Ella dancing](media/abc.mp4) — and becomes a player here. The regex only
 * ever sees the converter's own escaped output, never hand-written HTML.
 */
function render_markdown(string $source): string {
    if (trim($source) === '') return '';
    $html = (string)markdown_converter()->convert($source);
    $html = preg_replace('~<a href="(https?://[^"]*)"~', '<a rel="noopener noreferrer" href="$1"', $html);
    return preg_replace_callback('~<img src="(?:\./)?media/([a-f0-9]{8,32})\.([a-z0-9]{2,5})" alt="([^"]*)"(?: title="[^"]*")? />~', function ($m) {
        [, $id, $ext, $alt] = $m;
        $src = '/media/' . $id . '.' . $ext;
        $caption = $alt !== '' ? '<span class="media-caption">' . $alt . '</span>' : '';
        if (in_array($ext, VIDEO_EXTENSIONS, true)) {
            return '<span class="media media-video"><video controls preload="metadata" playsinline src="' . $src . '"'
                . ($alt !== '' ? ' aria-label="' . $alt . '"' : '') . '></video>' . $caption . '</span>';
        }
        return '<img class="media-image" loading="lazy" decoding="async" src="' . $src . '?size=display" data-full="' . $src . '" alt="' . $alt . '" />';
    }, $html);
}

function plain_excerpt(string $text, int $limit = 160): string {
    $text = trim(preg_replace('/\s+/', ' ', preg_replace('~!\[[^\]]*\]\([^)]*\)~', '', $text)));
    return mb_strlen($text) > $limit ? rtrim(mb_substr($text, 0, $limit)) . '…' : $text;
}

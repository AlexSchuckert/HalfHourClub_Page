<div class="login">
  <form class="login__card" method="post" action="/login/?next=<?= h(rawurlencode($next)) ?>">
    <h1 class="login__title">Half Hour Clubs</h1>
    <p class="login__hint">Enter the family password to look inside. This device will remember it for a year.</p>
    <?php if ($error): ?><p class="login__error" role="alert"><?= h($error) ?></p><?php endif ?>
    <label class="visually-hidden" for="password">Family password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" placeholder="Family password" required autofocus />
    <button class="button button--primary login__button" type="submit">Come in</button>
  </form>
</div>

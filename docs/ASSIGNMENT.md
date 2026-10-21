# Lead assignment

System Managers only: the **Assignment** link in CRM's left menu (it opens its own page, also at `/assignment`; it is not part of the Campaign Manager), and every server call behind it, check the role.

It looks and works like the Campaign Manager: a left menu with four pages - **Rules** (cards with an on/off switch, search and On / Off filters, and a Create rule button), **Assign leads now**, **Move leads** and **History** - and each form is a page of its own, not a pop-up.

## Rules (for new leads)

A rule is: *a lead that looks like this goes to these people.*

- **Conditions** use any Lead field (including your own custom fields) and any mix: *all of these* or *any of these*. Equals, is any of, contains, is set, between and so on, the same builder as campaign audiences.
- **People and how they share:**
  - **Round robin:** one person per lead, taking turns.
  - **Least workload:** the person with the fewest open leads plus follow-ups still to do.
  - **All of them together:** everybody gets every lead and can work it. The first person is the lead owner (a team lead goes first); the others are assigned to it too.
- Every enabled rule a new lead matches applies, **in the order shown**. A lead that matches two rules goes to the people of both. Because that is easy to do by accident, saving or switching on a rule that *can* match the same leads as another one asks first and lists the rules and how many existing leads match both. Rules that cannot overlap (State = Bihar and State = Delhi) never ask.
- Each person is notified in CRM when a lead is assigned to them. No email is sent. Disabled users are skipped.
- A lead created by a data **import** is not assigned automatically; use *Assign existing leads* afterwards.

## Existing leads

- On a rule: **Assign existing leads**, for the leads with no owner or for every matching lead, with a count and a sample first.
- **Assign leads now** (second tab): type conditions, choose people and how to share, and assign without making a rule.
- More than 300 leads run in a background job (the worker must be running); the result is added to *History*.

## Move leads

*Move leads* takes everything owned by, or assigned to, one or more people and gives it to others (round robin, least workload or all of them): "A to B", "A to B, C, D". They lose access to those leads. Open leads only, or every lead.

## History and undo

Every assignment is written to *CRM Assignment Log* and shown in *History*, one line per run (a rule run, an assign-now, a move) or per new lead: what, to whom, by whom. **Undo** (for a whole run or one lead) puts the leads back as they were for **24 hours**. A lead that somebody has changed since is left alone and counted as skipped; after 24 hours the line says "Too late to undo".

## Behind the scenes

Assignment uses CRM's own mechanism (the lead owner field, an assignment ToDo and a share), so CRM's list, permissions and notifications behave as for a hand-made assignment. After upgrading run `bench migrate` (new doctypes) and restart.

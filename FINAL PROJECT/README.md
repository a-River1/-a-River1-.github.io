This project is a combination of my submisison for HW#3 and HW#4.  FOr HW#3, I used 4 APIs to create
a beta version of a paralegal AI that could compile legal information for the average individual such
that they can collect data for suites given any circumstance they may find themselves in.  For this
project, I made a few improvements, and most importantly, added a backened to make it a fully functioning
web app that is usable by all.  The way to use this web app is to fill out all information labled required,
have it churn, and give you helpful documentation and ways to use it for your legal issues.  Additionaly, you
can use the provided chatbot for smaller and individual questions as well.  Inputs and sensitive data are
saved with the given API keys (mainly OpenAI), the information is processed with the backenew, and the APIs
work to spit out a result, give it to the backend to display on the front end.

AI was used for practically the entire assignment with little human intervention. While Codex sometimes
produced unwanted/bad results, human intervention solely took place via feedback.  An example is this
prompt:
'Looks great, let's work on some mor minute details.  Firstly, whenever research is being generated, it offers me to check pending research but this does nothing.  We can either remove this option entirely, or fix it.  If we fix it, explain what you want this function to do'

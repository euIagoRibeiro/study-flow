
    const studyForm = document.getElementById('study-form');
    const studiesList = document.getElementById('studies-list');

    function createStudyItem(topic, difficulty) {

        const li = document.createElement('li');
        li.classList.add('study-item');

        const studyInfoDiv = document.createElement('div');
        studyInfoDiv.classList.add('study-info');

        const topicSpan = document.createElement('span');
        topicSpan.classList.add('topic-name');
        topicSpan.textContent = topic;
        studyInfoDiv.appendChild(topicSpan);

        const difficultySpan = document.createElement('span');
        difficultySpan.classList.add('difficulty-tag');
        difficultySpan.classList.add(`tag-${difficulty}`);
        difficultySpan.textContent = difficulty;

        li.appendChild(studyInfoDiv);
        li.appendChild(difficultySpan);
        
        return li;
    }


    studyForm.addEventListener('submit', (event) => {

        event.preventDefault();

        const topicInput = document.getElementById('topic-input');
        const difficultySelect = document.getElementById('difficulty-select');

        const newEntry = createStudyItem(topicInput.value, difficultySelect.value);
        studiesList.appendChild(newEntry);
        
        topicInput.value = '';
        topicInput.focus();

    })
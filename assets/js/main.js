
    const studyForm = document.getElementById('study-form');
    const studiesList = document.getElementById('studies-list');

    studyForm.addEventListener('submit', (event) => {

        event.preventDefault();

        const topicInput = document.getElementById('topic-input');
        const difficultySelect = document.getElementById('difficulty-select');

        const newEntry = createStudyItem(topicInput.value, difficultySelect.value);
        studiesList.appendChild(newEntry);
        
        topicInput.value = '';
        topicInput.focus();

    })